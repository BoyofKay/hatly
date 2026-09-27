import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/utils/maps_helper.dart';
import '../data/driver_providers.dart';
import '../domain/delivery.dart';

/// CONFIRMED (locked decision): the lifecycle action buttons below are
/// the ONLY status-changing actions this screen offers — no Accept,
/// no Reject/Decline. `_nextActions` mirrors the approved lifecycle
/// only for which buttons to show; the backend's own
/// OrderStateMachineService (unmodified) is the sole authority.
List<(String, String)> _nextActions(String currentStatus) {
  switch (currentStatus) {
    case 'ASSIGNED_TO_DRIVER':
      return [('Picked Up', 'PICKED_UP'), ('Failed Delivery', 'FAILED_DELIVERY')];
    case 'PICKED_UP':
      return [('On The Way', 'ON_THE_WAY'), ('Failed Delivery', 'FAILED_DELIVERY')];
    case 'ON_THE_WAY':
      return [('Delivered', 'DELIVERED'), ('Failed Delivery', 'FAILED_DELIVERY')];
    default:
      return const [];
  }
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

  Future<void> _updateStatus(String status, {DriverFailedDeliveryReason? failureReason}) async {
    if (_isSubmitting) return;
    setState(() {
      _isSubmitting = true;
      _actionError = null;
    });
    try {
      await ref.read(driverApiProvider).updateDeliveryStatus(widget.deliveryId, status, failureReason: failureReason);
      ref.invalidate(deliveryDetailProvider(widget.deliveryId));
      ref.invalidate(deliveriesProvider);
    } on DioException catch (error) {
      final message = error.response?.data is Map ? (error.response?.data as Map)['message'] : null;
      setState(() => _actionError = (message as String?) ?? 'Failed to update status.');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  /// Driver Core + Dispatch Foundation milestone. A reason is REQUIRED before the "Failed Delivery"
  /// action actually submits — a plain, modal, single-choice picker from the controlled
  /// `DriverFailedDeliveryReason` list; dismissing it (no selection) submits nothing, same as
  /// tapping any other button and then changing your mind.
  Future<void> _pickFailureReasonAndSubmit() async {
    final reason = await showDialog<DriverFailedDeliveryReason>(
      context: context,
      builder: (dialogContext) => SimpleDialog(
        title: const Text('Why did the delivery fail?'),
        children: [
          for (final r in DriverFailedDeliveryReason.values)
            SimpleDialogOption(
              onPressed: () => Navigator.of(dialogContext).pop(r),
              child: Text(r.label),
            ),
        ],
      ),
    );
    if (reason == null || !mounted) return;
    await _updateStatus('FAILED_DELIVERY', failureReason: reason);
  }

  Future<void> _recordWeight(String itemId) async {
    final raw = _weightInputs[itemId];
    final grams = int.tryParse(raw ?? '');
    if (grams == null || grams <= 0) {
      setState(() => _actionError = 'Enter a valid weight in grams.');
      return;
    }
    setState(() => _actionError = null);
    try {
      await ref.read(driverApiProvider).recordWeight(itemId, grams);
      ref.invalidate(deliveryDetailProvider(widget.deliveryId));
    } on DioException catch (error) {
      final message = error.response?.data is Map ? (error.response?.data as Map)['message'] : null;
      // Covers the first-actor-wins rejection (e.g. already recorded by
      // the vendor) as a normal, expected outcome — never a crash.
      setState(() => _actionError = (message as String?) ?? 'Could not record weight — it may already be recorded.');
    }
  }

  Future<void> _recordPurchaseAmount(String itemId) async {
    final raw = _purchaseInputs[itemId];
    final amount = double.tryParse(raw ?? '');
    if (amount == null || amount <= 0) {
      setState(() => _actionError = 'Enter a valid amount.');
      return;
    }
    setState(() => _actionError = null);
    try {
      await ref.read(driverApiProvider).recordPurchaseAmount(itemId, (amount * 100).round());
      ref.invalidate(deliveryDetailProvider(widget.deliveryId));
    } on DioException catch (error) {
      final message = error.response?.data is Map ? (error.response?.data as Map)['message'] : null;
      setState(() => _actionError = (message as String?) ?? 'Could not record purchase amount.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final deliveryAsync = ref.watch(deliveryDetailProvider(widget.deliveryId));

    return Scaffold(
      appBar: AppBar(title: const Text('Delivery')),
      body: deliveryAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Could not load this delivery.'),
              TextButton(
                onPressed: () => ref.invalidate(deliveryDetailProvider(widget.deliveryId)),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (delivery) => _buildContent(delivery),
      ),
    );
  }

  Widget _buildContent(Delivery delivery) {
    final actions = _nextActions(delivery.orderStatus);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _SectionCard(
          title: 'Order',
          children: [
            Text('Status: ${delivery.orderStatus}'),
            Text('Payment: ${delivery.paymentMethod}${delivery.electronicPaymentMethod != null ? ' (${delivery.electronicPaymentMethod})' : ''}'),
            Text('Total: ${(delivery.totalMinor / 100).toStringAsFixed(2)}'),
            // Driver Core + Dispatch Foundation milestone: the amount to actually collect — distinct
            // from Total above whenever a wallet credit already covered part of the order. Shown only
            // when there is something to collect on delivery (COD / PAY_AT_DELIVERY); a Manual
            // Transfer order was already paid before dispatch, so nothing is shown for it.
            if (delivery.hasCollectionOnDelivery && delivery.amountDueMinor != null)
              Text(
                'Amount to collect: ${(delivery.amountDueMinor! / 100).toStringAsFixed(2)}',
                style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.deepOrange),
              ),
            if (delivery.orderNote != null) Text('Note: ${delivery.orderNote}'),
          ],
        ),
        _SectionCard(
          title: 'Customer',
          children: [
            Text(delivery.customerName),
            Row(
              children: [
                Expanded(child: Text(delivery.customerPhone)),
                IconButton(
                  icon: const Icon(Icons.call),
                  onPressed: () => launchUrl(Uri(scheme: 'tel', path: delivery.customerPhone)),
                ),
              ],
            ),
            Text(delivery.deliveryAddress.line1),
            if (delivery.deliveryAddress.instructions != null)
              Text('Instructions: ${delivery.deliveryAddress.instructions}'),
            OutlinedButton.icon(
              icon: const Icon(Icons.map_outlined),
              label: const Text('Open in Maps'),
              onPressed: () => openInMaps(
                latitude: delivery.deliveryAddress.latitude,
                longitude: delivery.deliveryAddress.longitude,
              ),
            ),
          ],
        ),
        for (final segment in delivery.segments)
          _SectionCard(
            title: segment.vendorBranchName ?? segment.adHocPlaceNameSnapshot ?? 'Pickup',
            children: [
              Text('Status: ${segment.status}'),
              if (segment.vendorBranchAddress != null) Text(segment.vendorBranchAddress!),
              if (segment.vendorBranchLatitude != null && segment.vendorBranchLongitude != null)
                OutlinedButton.icon(
                  icon: const Icon(Icons.map_outlined),
                  label: const Text('Open in Maps'),
                  onPressed: () => openInMaps(
                    latitude: segment.vendorBranchLatitude!,
                    longitude: segment.vendorBranchLongitude!,
                  ),
                ),
              const SizedBox(height: 8),
              for (final item in segment.items) _ItemTile(
                item: item,
                weightInputs: _weightInputs,
                purchaseInputs: _purchaseInputs,
                onRecordWeight: () => _recordWeight(item.id),
                onRecordPurchase: () => _recordPurchaseAmount(item.id),
                onChanged: () => setState(() {}),
              ),
            ],
          ),
        if (_actionError != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(_actionError!, style: const TextStyle(color: Colors.red)),
          ),
        if (actions.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Wrap(
              spacing: 8,
              children: [
                for (final action in actions)
                  FilledButton(
                    onPressed: _isSubmitting
                        ? null
                        : action.$2 == 'FAILED_DELIVERY'
                            ? _pickFailureReasonAndSubmit
                            : () => _updateStatus(action.$2),
                    style: action.$2 == 'FAILED_DELIVERY'
                        ? FilledButton.styleFrom(backgroundColor: Colors.grey.shade600)
                        : null,
                    child: Text(action.$1),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            ...children,
          ],
        ),
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
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${item.productNameSnapshot ?? item.freeTextDescriptionSnapshot ?? 'Item'} x${item.quantity}'),
          if (item.isWeighted)
            item.actualWeightGrams != null
                ? Text('Weight recorded: ${(item.actualWeightGrams! / 1000).toStringAsFixed(2)} kg',
                    style: const TextStyle(color: Colors.green))
                : Row(
                    children: [
                      Text('Requested: ${item.requestedWeightGrams != null ? (item.requestedWeightGrams! / 1000).toStringAsFixed(2) : '—'} kg  '),
                      SizedBox(
                        width: 100,
                        child: TextField(
                          decoration: const InputDecoration(hintText: 'grams', isDense: true),
                          keyboardType: TextInputType.number,
                          onChanged: (v) {
                            weightInputs[item.id] = v;
                            onChanged();
                          },
                        ),
                      ),
                      TextButton(onPressed: onRecordWeight, child: const Text('Save')),
                    ],
                  ),
          if (item.isAdHoc)
            Row(
              children: [
                const Text('Purchase amount:  '),
                SizedBox(
                  width: 100,
                  child: TextField(
                    decoration: const InputDecoration(hintText: 'amount', isDense: true),
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    onChanged: (v) {
                      purchaseInputs[item.id] = v;
                      onChanged();
                    },
                  ),
                ),
                TextButton(onPressed: onRecordPurchase, child: const Text('Save')),
              ],
            ),
        ],
      ),
    );
  }
}
