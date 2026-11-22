import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/localization/bilingual.dart';
import '../../../core/utils/maps_helper.dart';
import '../../../core/utils/money.dart';
import '../../../shared_widgets/driver_ui.dart';
import '../data/driver_providers.dart';
import '../domain/delivery.dart';
import 'cash_collection_sheet.dart';
import 'proof_of_delivery_sheet.dart';
import 'status_labels.dart';

/// CONFIRMED (locked decision): the lifecycle action buttons below are the ONLY status-changing actions this screen offers — no Accept, no
/// Reject/Decline. `_nextActions` mirrors the approved lifecycle only for which buttons to show; the backend's own OrderStateMachineService
/// (unmodified) is the sole authority.
List<(String en, String ar, String status)> _nextActions(String currentStatus) {
  switch (currentStatus) {
    case 'ASSIGNED_TO_DRIVER':
      return [('Picked Up', 'تم الاستلام من المتجر', 'PICKED_UP'), ('Failed Delivery', 'توصيل فاشل', 'FAILED_DELIVERY')];
    case 'PICKED_UP':
      return [('On The Way', 'في الطريق للعميل', 'ON_THE_WAY'), ('Failed Delivery', 'توصيل فاشل', 'FAILED_DELIVERY')];
    case 'ON_THE_WAY':
      return [('Delivered', 'تم التسليم', 'DELIVERED'), ('Failed Delivery', 'توصيل فاشل', 'FAILED_DELIVERY')];
    default:
      return const [];
  }
}

/// A request that never got an answer (no connection, a timeout, or a server error): the action MAY have been applied, so it is checked
/// rather than assumed either way.
bool _isUncertain(DioException error) {
  final code = error.response?.statusCode;
  return code == null || code >= 500;
}

class DeliveryDetailScreen extends ConsumerStatefulWidget {
  const DeliveryDetailScreen({super.key, required this.deliveryId});

  final String deliveryId;

  @override
  ConsumerState<DeliveryDetailScreen> createState() => _DeliveryDetailScreenState();
}

class _DeliveryDetailScreenState extends ConsumerState<DeliveryDetailScreen> {
  String? _actionError;
  bool _isSubmitting = false;
  final Map<String, String> _weightInputs = {};
  final Map<String, String> _purchaseInputs = {};

  String _serverMessage(DioException error, String fallback) {
    final data = error.response?.data;
    final message = data is Map ? data['message'] : null;
    return message is String && message.isNotEmpty ? message : fallback;
  }

  Future<void> _updateStatus(
    String status, {
    DriverFailedDeliveryReason? failureReason,
    String? proofPhotoUrl,
    String? recipientName,
  }) async {
    if (_isSubmitting) return;
    setState(() {
      _isSubmitting = true;
      _actionError = null;
    });
    try {
      await ref.read(driverApiProvider).updateDeliveryStatus(
            widget.deliveryId,
            status,
            failureReason: failureReason,
            proofPhotoUrl: proofPhotoUrl,
            recipientName: recipientName,
          );
      ref.invalidate(deliveryDetailProvider(widget.deliveryId));
      ref.invalidate(deliveriesProvider);
      ref.invalidate(earningsProvider);
    } on DioException catch (error) {
      if (_isUncertain(error)) {
        // The answer was lost, not necessarily the action: read the order back. The server treats a repeat of an already-applied status as a
        // no-op, so tapping again is always safe — but if it is already applied there is nothing left to do.
        final applied = await _statusAlreadyApplied(status);
        if (!mounted) return;
        if (applied) {
          ref.invalidate(deliveriesProvider);
          ref.invalidate(earningsProvider);
        } else {
          setState(() => _actionError = context.t('No connection — the update may not have gone through. Please try again.', 'لا يوجد اتصال — ربما لم يتم التحديث. حاول مرة أخرى.'));
        }
      } else {
        setState(() => _actionError = _serverMessage(error, context.t('Failed to update status.', 'تعذّر تحديث الحالة.')));
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  /// R16: confirm having seen the assignment. Repeating is harmless (the server keeps the first confirmation).
  Future<void> _acknowledge() async {
    if (_isSubmitting) return;
    setState(() {
      _isSubmitting = true;
      _actionError = null;
    });
    try {
      await ref.read(driverApiProvider).acknowledgeDelivery(widget.deliveryId);
      ref.invalidate(deliveryDetailProvider(widget.deliveryId));
      ref.invalidate(deliveriesProvider);
    } on DioException catch (error) {
      if (mounted) setState(() => _actionError = _serverMessage(error, context.t('Could not confirm. Please try again.', 'تعذّر التأكيد. حاول مرة أخرى.')));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<bool> _statusAlreadyApplied(String status) async {
    try {
      final fresh = await ref.refresh(deliveryDetailProvider(widget.deliveryId).future);
      return fresh.orderStatus == status;
    } catch (_) {
      return false;
    }
  }

  /// M4. The "Delivered" action has two required real-evidence steps before it ever calls `_updateStatus`: (1) cash collection — ONLY for
  /// COD/PAY_AT_DELIVERY orders with a real `amountDueMinor`, and ONLY submits a cash-remainder claim when the driver actually collected more
  /// than what was due; (2) Proof of Delivery — always required, a real uploaded photo the backend itself verifies ownership of. Cancelling
  /// either step leaves the delivery untouched.
  Future<void> _completeDelivery(Delivery delivery) async {
    if (_isSubmitting) return;

    if (delivery.hasCollectionOnDelivery && delivery.amountDueMinor != null) {
      final cashResult = await showModalBottomSheet<CashCollectionResult>(
        context: context,
        isScrollControlled: true,
        builder: (_) => CashCollectionSheet(amountDueMinor: delivery.amountDueMinor!),
      );
      if (cashResult == null || !mounted) return;

      if (cashResult.cashReceivedMinor > delivery.amountDueMinor!) {
        setState(() {
          _isSubmitting = true;
          _actionError = null;
        });
        try {
          await ref.read(driverApiProvider).submitCashRemainder(widget.deliveryId, cashResult.cashReceivedMinor);
        } on DioException catch (error) {
          if (mounted) {
            setState(() => _actionError = _isUncertain(error)
                ? context.t('No connection — the cash amount may not have been recorded. Please try again.', 'لا يوجد اتصال — ربما لم يُسجَّل مبلغ النقد. حاول مرة أخرى.')
                : _serverMessage(error, context.t('Could not record the cash collected.', 'تعذّر تسجيل النقد المحصّل.')));
          }
          return;
        } finally {
          if (mounted) setState(() => _isSubmitting = false);
        }
      }
    }
    if (!mounted) return;

    final podResult = await showModalBottomSheet<ProofOfDeliveryResult>(
      context: context,
      isScrollControlled: true,
      builder: (_) => ProofOfDeliverySheet(
        uploadPhoto: (bytes, filename) => ref.read(driverApiProvider).uploadProofPhoto(bytes, filename),
        pickPhoto: ref.read(proofOfDeliveryPhotoPickerProvider),
      ),
    );
    if (podResult == null || !mounted) return;

    await _updateStatus('DELIVERED', proofPhotoUrl: podResult.photoUrl, recipientName: podResult.recipientName);
  }

  /// A reason is REQUIRED before "Failed Delivery" submits — a single-choice picker from the controlled `DriverFailedDeliveryReason` list;
  /// dismissing it submits nothing.
  Future<void> _pickFailureReasonAndSubmit() async {
    final arabic = context.isArabic;
    final reason = await showDialog<DriverFailedDeliveryReason>(
      context: context,
      builder: (dialogContext) => SimpleDialog(
        title: Text(dialogContext.t('Why did the delivery fail?', 'لماذا فشل التوصيل؟')),
        children: [
          for (final r in DriverFailedDeliveryReason.values)
            SimpleDialogOption(
              onPressed: () => Navigator.of(dialogContext).pop(r),
              child: Text(r.localized(arabic)),
            ),
        ],
      ),
    );
    if (reason == null || !mounted) return;
    await _updateStatus('FAILED_DELIVERY', failureReason: reason);
  }

  Future<void> _recordWeight(String itemId) async {
    final grams = int.tryParse(_weightInputs[itemId] ?? '');
    if (grams == null || grams <= 0) {
      setState(() => _actionError = context.t('Enter a valid weight in grams.', 'أدخل وزنًا صحيحًا بالجرام.'));
      return;
    }
    setState(() => _actionError = null);
    try {
      await ref.read(driverApiProvider).recordWeight(itemId, grams);
      ref.invalidate(deliveryDetailProvider(widget.deliveryId));
    } on DioException catch (error) {
      if (!mounted) return;
      // First-actor-wins rejection (already recorded by the vendor) is a normal outcome — never a crash. A lost answer is re-read, because
      // recording is not retried blindly.
      if (_isUncertain(error)) {
        final fresh = await _refreshOrNull();
        final recorded = fresh?.segments.expand((s) => s.items).any((i) => i.id == itemId && i.actualWeightGrams != null) ?? false;
        if (!mounted) return;
        setState(() => _actionError = recorded ? null : context.t('No connection — the weight may not have been saved. Please try again.', 'لا يوجد اتصال — ربما لم يُحفظ الوزن. حاول مرة أخرى.'));
      } else {
        setState(() => _actionError = _serverMessage(error, context.t('Could not record weight — it may already be recorded.', 'تعذّر تسجيل الوزن — ربما سُجّل من قبل.')));
      }
    }
  }

  Future<void> _recordPurchaseAmount(String itemId) async {
    // Integer money only: "40", "40.5" and "٤٠٫٥٠" are exact; anything else is rejected rather than rounded.
    final minor = parseEgpToMinor(_purchaseInputs[itemId] ?? '');
    if (minor == null) {
      setState(() => _actionError = context.t('Enter a valid amount.', 'أدخل مبلغًا صحيحًا.'));
      return;
    }
    setState(() => _actionError = null);
    try {
      await ref.read(driverApiProvider).recordPurchaseAmount(itemId, minor);
      ref.invalidate(deliveryDetailProvider(widget.deliveryId));
    } on DioException catch (error) {
      if (!mounted) return;
      if (_isUncertain(error)) {
        final fresh = await _refreshOrNull();
        if (!mounted) return;
        setState(() => _actionError = fresh == null ? context.t('No connection — the amount may not have been saved. Please try again.', 'لا يوجد اتصال — ربما لم يُحفظ المبلغ. حاول مرة أخرى.') : null);
      } else {
        setState(() => _actionError = _serverMessage(error, context.t('Could not record purchase amount.', 'تعذّر تسجيل مبلغ الشراء.')));
      }
    }
  }

  Future<Delivery?> _refreshOrNull() async {
    try {
      return await ref.refresh(deliveryDetailProvider(widget.deliveryId).future);
    } catch (_) {
      return null;
    }
  }

  Widget _routePoint(String keyPrefix, String heading, RoutePoint point) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(heading, style: const TextStyle(fontWeight: FontWeight.bold)),
        Text('${point.label}${point.isDefault ? ' (${context.t('default point', 'نقطة افتراضية')})' : ''}', key: Key('$keyPrefix-label')),
        OutlinedButton.icon(
          key: Key('$keyPrefix-maps'),
          icon: const Icon(Icons.map_outlined),
          label: Text(context.t('Open in Maps', 'فتح في الخرائط')),
          onPressed: () => openInMaps(latitude: point.latitude, longitude: point.longitude),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    // Keeps the poll alive while this screen is open, so a status change made by Admin shows up here too.
    ref.watch(driverPollingServiceProvider);
    final deliveryAsync = ref.watch(deliveryDetailProvider(widget.deliveryId));
    final delivery = deliveryAsync.valueOrNull;
    // R16: an unacknowledged assignment offers only the acknowledgement; the normal steps follow once it is confirmed.
    final actions = delivery == null || delivery.needsAcknowledgement ? const <(String, String, String)>[] : _nextActions(delivery.orderStatus);

    return Scaffold(
      backgroundColor: const Color(0xFFFAFAFA),
      appBar: AppBar(
        title: Text(delivery == null ? context.t('Delivery', 'التوصيل') : delivery.displayNumber, textDirection: delivery == null ? null : TextDirection.ltr),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        actions: [if (delivery != null) Padding(padding: const EdgeInsetsDirectional.only(end: 12), child: Center(child: StatusChip(delivery.orderStatus)))],
      ),
      body: deliveryAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => MessageView(
          icon: Icons.cloud_off_outlined,
          message: context.t('Could not load this delivery.', 'تعذّر تحميل هذا الطلب.'),
          onRetry: () => ref.invalidate(deliveryDetailProvider(widget.deliveryId)),
        ),
        data: (d) => _buildContent(d),
      ),
      bottomNavigationBar: delivery != null && delivery.needsAcknowledgement
          ? SafeArea(
              child: Container(
                key: const Key('ack-bar'),
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Color(0xFFE9E9E9)))),
                child: FilledButton.icon(
                  key: const Key('acknowledge-button'),
                  onPressed: _isSubmitting ? null : _acknowledge,
                  icon: const Icon(Icons.visibility_outlined),
                  label: Text(context.t("I've seen this order", 'اطّلعت على الطلب')),
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
                ),
              ),
            )
          : actions.isEmpty
          ? null
          : SafeArea(
              child: Container(
                key: const Key('action-bar'),
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Color(0xFFE9E9E9)))),
                child: Row(
                  children: [
                    for (final action in actions)
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 4),
                          child: FilledButton(
                            onPressed: _isSubmitting
                                ? null
                                : action.$3 == 'FAILED_DELIVERY'
                                    ? _pickFailureReasonAndSubmit
                                    : action.$3 == 'DELIVERED'
                                        ? () => _completeDelivery(delivery!)
                                        : () => _updateStatus(action.$3),
                            style: FilledButton.styleFrom(
                              minimumSize: const Size.fromHeight(50),
                              backgroundColor: action.$3 == 'FAILED_DELIVERY' ? Colors.grey.shade600 : null,
                            ),
                            child: Text(context.t(action.$1, action.$2), textAlign: TextAlign.center),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildContent(Delivery delivery) {
    final ar = context.isArabic;
    final address = delivery.deliveryAddress;
    final details = _addressDetails(context, address);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_isSubmitting) const Padding(padding: EdgeInsets.only(bottom: 8), child: LinearProgressIndicator()),
        if (_actionError != null)
          Container(
            key: const Key('action-error'),
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFFFDECEA), borderRadius: BorderRadius.circular(12)),
            child: Text(_actionError!, style: const TextStyle(color: Color(0xFFB71C1C))),
          ),
        if (delivery.orderStatus == 'ASSIGNED_TO_DRIVER' || delivery.isBeingPrepared) _AcknowledgementCard(delivery: delivery),
        if (delivery.isBeingPrepared)
          Container(
            key: const Key('being-prepared-note'),
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFFFFF4E5), borderRadius: BorderRadius.circular(12)),
            child: Text(context.t(
                'The store is still preparing this order. Head to the store now — you can mark it picked up once the store marks it ready.',
                'المتجر ما زال يحضّر هذا الطلب. توجّه إلى المتجر الآن — يمكنك تسجيل الاستلام بعد أن يعلن المتجر أنه جاهز.')),
          ),
        _SectionCard(
          title: context.t('Order', 'الطلب'),
          icon: Icons.receipt_long_outlined,
          children: [
            Text('${context.t('Payment', 'الدفع')}: ${_paymentLabel(context, delivery.paymentMethod)}${delivery.electronicPaymentMethod != null ? ' (${delivery.electronicPaymentMethod})' : ''}'),
            Text(delivery.totalMinor == null
                ? context.t('Total: price pending (confirmed during preparation)', 'الإجمالي: السعر قيد التأكيد أثناء التجهيز')
                : '${context.t('Total', 'الإجمالي')}: ${formatMinor(delivery.totalMinor, arabic: ar)}'),
            // The amount to actually collect — distinct from Total whenever a wallet credit already covered part of the order. Only when there
            // is something to collect at the door; a Manual Transfer order was already paid, so nothing is shown for it.
            if (delivery.hasCollectionOnDelivery && delivery.amountDueMinor != null)
              Container(
                margin: const EdgeInsets.only(top: 8),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(color: const Color(0xFFFFF3E8), borderRadius: BorderRadius.circular(12)),
                child: Text(
                  '${context.t('Amount to collect', 'المبلغ المطلوب تحصيله')}: ${formatMinor(delivery.amountDueMinor, arabic: ar)}',
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: Color(0xFFE0650A)),
                ),
              ),
            if (delivery.orderNote != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text('${context.t('Note', 'ملاحظة')}: ${delivery.orderNote}')),
          ],
        ),
        _SectionCard(
          title: context.t('Customer', 'العميل'),
          icon: Icons.person_outline,
          children: [
            Text(delivery.customerName, style: const TextStyle(fontWeight: FontWeight.w600)),
            if (delivery.customerPhone != null)
              Row(
                children: [
                  Expanded(child: Text(delivery.customerPhone!, textDirection: TextDirection.ltr, textAlign: ar ? TextAlign.right : TextAlign.left)),
                  IconButton(
                    key: const Key('call-customer'),
                    icon: const Icon(Icons.call),
                    onPressed: () => launchUrl(Uri(scheme: 'tel', path: delivery.customerPhone)),
                  ),
                ],
              ),
            if (address.areaLabel != null)
              Text(address.areaLabel!, key: const Key('delivery-area'), textDirection: TextDirection.rtl, style: const TextStyle(fontWeight: FontWeight.bold)),
            Text(address.line1),
            if (details != null) Text(details, key: const Key('delivery-address-details')),
            if (address.instructions != null) Text('${context.t('Instructions', 'تعليمات')}: ${address.instructions}'),
            if (address.hasPin)
              OutlinedButton.icon(
                icon: const Icon(Icons.map_outlined),
                label: Text(context.t('Open in Maps', 'فتح في الخرائط')),
                onPressed: () => openInMaps(latitude: address.latitude!, longitude: address.longitude!),
              )
            else
              Text(context.t('No map pin — use the area and the written address above.', 'لا توجد علامة على الخريطة — استخدم المنطقة والعنوان المكتوب أعلاه.'), key: const Key('delivery-no-pin')),
          ],
        ),
        if (delivery.serviceRoute != null)
          _SectionCard(
            title: delivery.serviceRoute!.service == 'WASALLY' ? 'Route — Wasally' : 'Route — Hatly',
            icon: Icons.route_outlined,
            children: [
              _routePoint('route-origin', context.t('From (go here first)', 'من (اذهب إلى هنا أولًا)'), delivery.serviceRoute!.origin),
              const SizedBox(height: 8),
              _routePoint('route-destination', context.t('To (deliver here)', 'إلى (سلّم هنا)'), delivery.serviceRoute!.destination),
              const SizedBox(height: 4),
              Text(context.t('The customer\'s address above is who to contact — the route above is where to go.', 'عنوان العميل أعلاه هو جهة الاتصال — المسار أعلاه هو وجهتك.'), key: const Key('route-note')),
            ],
          ),
        for (final segment in delivery.segments)
          _SectionCard(
            title: segment.vendorBranchName ?? segment.adHocPlaceNameSnapshot ?? context.t('Pickup', 'الاستلام'),
            icon: Icons.storefront_outlined,
            children: [
              Text('${context.t('Status', 'الحالة')}: ${statusLabel(context, segment.status)}'),
              if (segment.vendorBranchAddress != null) Text(segment.vendorBranchAddress!),
              if (segment.vendorNoteSnapshot != null && segment.vendorNoteSnapshot!.isNotEmpty)
                Padding(padding: const EdgeInsets.only(top: 4), child: Text('${context.t('Pickup note', 'ملاحظة الاستلام')}: ${segment.vendorNoteSnapshot}', key: Key('pickup-note-${segment.id}'))),
              if (segment.vendorBranchLatitude != null && segment.vendorBranchLongitude != null)
                OutlinedButton.icon(
                  icon: const Icon(Icons.map_outlined),
                  label: Text(context.t('Open in Maps', 'فتح في الخرائط')),
                  onPressed: () => openInMaps(latitude: segment.vendorBranchLatitude!, longitude: segment.vendorBranchLongitude!),
                ),
              const SizedBox(height: 8),
              for (final item in segment.items)
                _ItemTile(
                  item: item,
                  weightInputs: _weightInputs,
                  purchaseInputs: _purchaseInputs,
                  onRecordWeight: () => _recordWeight(item.id),
                  onRecordPurchase: () => _recordPurchaseAmount(item.id),
                  onChanged: () => setState(() {}),
                ),
            ],
          ),
        const SizedBox(height: 12),
      ],
    );
  }
}

String _paymentLabel(BuildContext context, String method) {
  switch (method) {
    case 'COD':
    case 'PAY_AT_DELIVERY':
      return context.t(method, 'الدفع عند الاستلام');
    default:
      return method;
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.children, this.icon});

  final String title;
  final IconData? icon;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return DriverCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            if (icon != null) ...[Icon(icon, size: 18, color: Theme.of(context).colorScheme.primary), const SizedBox(width: 6)],
            Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800))),
          ]),
          const SizedBox(height: 8),
          ...children,
        ],
      ),
    );
  }
}

class _ItemTile extends StatelessWidget {
  const _ItemTile({
    required this.item,
    required this.weightInputs,
    required this.purchaseInputs,
    required this.onRecordWeight,
    required this.onRecordPurchase,
    required this.onChanged,
  });

  final DeliverySegmentItem item;
  final Map<String, String> weightInputs;
  final Map<String, String> purchaseInputs;
  final VoidCallback onRecordWeight;
  final VoidCallback onRecordPurchase;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final ar = context.isArabic;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${item.productNameSnapshot ?? item.freeTextDescriptionSnapshot ?? context.t('Item', 'صنف')} x${item.quantity}', style: const TextStyle(fontWeight: FontWeight.w600)),
          if (item.notes != null && item.notes!.isNotEmpty) Text(item.notes!, style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B))),
          if (item.isWeighted)
            item.actualWeightGrams != null
                ? Text('${context.t('Weight recorded', 'الوزن المسجّل')}: ${formatGrams(item.actualWeightGrams!, arabic: ar)}', style: const TextStyle(color: Colors.green))
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${context.t('Requested', 'المطلوب')}: ${item.requestedWeightGrams != null ? formatGrams(item.requestedWeightGrams!, arabic: ar) : '—'}'),
                      Row(
                        children: [
                          SizedBox(
                            width: 120,
                            child: TextField(
                              decoration: InputDecoration(hintText: context.t('grams', 'جرام'), isDense: true),
                              keyboardType: TextInputType.number,
                              onChanged: (v) {
                                weightInputs[item.id] = v;
                                onChanged();
                              },
                            ),
                          ),
                          TextButton(onPressed: onRecordWeight, child: Text(context.t('Save', 'حفظ'))),
                        ],
                      ),
                    ],
                  ),
          if (item.isAdHoc)
            Row(
              children: [
                Text('${context.t('Purchase amount', 'مبلغ الشراء')}:  '),
                SizedBox(
                  width: 110,
                  child: TextField(
                    decoration: InputDecoration(hintText: context.t('amount', 'المبلغ'), isDense: true),
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    onChanged: (v) {
                      purchaseInputs[item.id] = v;
                      onChanged();
                    },
                  ),
                ),
                TextButton(onPressed: onRecordPurchase, child: Text(context.t('Save', 'حفظ'))),
              ],
            ),
        ],
      ),
    );
  }
}

/// Building / floor / apartment / landmark in one line, or null when the customer gave none.
String? _addressDetails(BuildContext context, DeliveryAddress a) {
  final parts = <String>[
    if (a.buildingNumber != null) '${context.t('Building', 'مبنى')} ${a.buildingNumber}',
    if (a.floor != null) '${context.t('Floor', 'الدور')} ${a.floor}',
    if (a.apartment != null) '${context.t('Apt', 'شقة')} ${a.apartment}',
    if (a.landmark != null) a.landmark!,
  ];
  return parts.isEmpty ? null : parts.join(' · ');
}


/// R16/R17: the assignment card — acknowledge-by time (or when it was acknowledged) and how to reach Operations. Drivers cannot release an
/// order themselves: if there is a problem, they call Operations.
class _AcknowledgementCard extends ConsumerWidget {
  const _AcknowledgementCard({required this.delivery});

  final Delivery delivery;

  String _time(BuildContext context, DateTime at) => TimeOfDay.fromDateTime(at.toLocal()).format(context);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final phone = ref.watch(operationsPhoneProvider).valueOrNull;
    final acknowledged = delivery.acknowledgedAt;
    final deadline = delivery.acceptDeadlineAt;
    final overdue = acknowledged == null && deadline != null && deadline.isBefore(DateTime.now());
    return Container(
      key: const Key('acknowledgement-card'),
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: acknowledged != null ? const Color(0xFFE8F5E9) : (overdue ? const Color(0xFFFFF3E0) : const Color(0xFFE3F2FD)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (acknowledged != null)
            Text(context.t('Seen at ${_time(context, acknowledged)}', 'تم الاطلاع الساعة ${_time(context, acknowledged)}'),
                key: const Key('acknowledged-at'), style: const TextStyle(fontWeight: FontWeight.w600))
          else ...[
            Text(context.t('New assignment — please confirm you have seen it', 'إسناد جديد — أكّد اطلاعك عليه'),
                style: const TextStyle(fontWeight: FontWeight.w600)),
            if (deadline != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  overdue
                      ? context.t('Confirmation was due at ${_time(context, deadline)} — Operations have been told', 'كان التأكيد مطلوبًا قبل ${_time(context, deadline)} — تم إبلاغ العمليات')
                      : context.t('Confirm by ${_time(context, deadline)}', 'أكّد قبل ${_time(context, deadline)}'),
                  key: const Key('acknowledge-deadline'),
                ),
              ),
          ],
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(context.t('A problem with this order? Call Operations — they can reassign it.', 'مشكلة في هذا الطلب؟ اتصل بالعمليات — يمكنهم إعادة إسناده.'),
                style: const TextStyle(fontSize: 13)),
          ),
          if (phone != null)
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                key: const Key('call-operations'),
                onPressed: () => launchUrl(Uri(scheme: 'tel', path: phone)),
                icon: const Icon(Icons.support_agent),
                label: Text(context.t('Call Operations', 'اتصل بالعمليات')),
              ),
            ),
        ],
      ),
    );
  }
}
