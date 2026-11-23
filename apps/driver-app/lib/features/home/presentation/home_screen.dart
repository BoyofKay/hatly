import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../deliveries/data/driver_providers.dart';
import '../../deliveries/domain/delivery.dart';
import '../../deliveries/presentation/status_labels.dart';
import '../../../core/localization/bilingual.dart';
import '../../../core/utils/money.dart';
import '../../earnings/domain/earnings.dart';
import '../../../shared_widgets/driver_ui.dart';

/// Real Driver Home — online/offline toggle (wired to the real
/// `PATCH driver/online-status` + the GPS timer, see
/// DriverOnlineStateNotifier) and the assigned-delivery list (real
/// `GET driver/deliveries`). CONFIRMED (locked decision): no
/// Accept/Reject anywhere — a delivery already appearing here means
/// it has already been assigned, by the system or by Admin.
///
/// M4 — Driver polling / refresh fallback. `ConsumerStatefulWidget` (was
/// stateless) specifically so this screen can own its own poll lifecycle:
/// starts on mount, pauses while the app is backgrounded, resumes on
/// foreground, and stops on unmount (logout navigates away from this
/// screen, which disposes it) — see `DriverPollingService`'s own comment
/// for why this never replaces push notifications or duplicates requests.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _startPolling();
    // The switch shows the server's state, not a default "offline" (2026-11-15).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(driverOnlineStateProvider.notifier).syncFromServer();
    });
  }

  void _startPolling() {
    ref.read(driverPollingServiceProvider).start(() async {
      ref.invalidate(deliveriesProvider);
      await ref.read(deliveriesProvider.future);
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        _startPolling();
        ref.read(driverOnlineStateProvider.notifier).syncFromServer();
      case AppLifecycleState.paused:
      case AppLifecycleState.inactive:
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
        ref.read(driverPollingServiceProvider).stop();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Establishes this screen's own keep-alive subscription on the
    // `autoDispose` polling-service provider — see that provider's comment.
    ref.watch(driverPollingServiceProvider);
    final onlineAsync = ref.watch(driverOnlineStateProvider);
    final deliveriesAsync = ref.watch(deliveriesProvider);
    final isOnline = onlineAsync.valueOrNull ?? false;
    // Money is secondary here: if it cannot be read the orders still work, so a failure is simply "no figure".
    final shift = ref.watch(earningsProvider).valueOrNull?.open;
    final deliveredToday = ref.watch(earningsProvider).valueOrNull?.deliveredToday;
    final orange = Theme.of(context).colorScheme.primary;

    return Scaffold(
      backgroundColor: const Color(0xFFFAFAFA),
      appBar: AppBar(
        title: Text(context.t('Hatly Driver', 'سائق هاتلي')),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
      ),
      body: Column(
        children: [
          // Online card: the one switch that decides whether orders can be assigned to you.
          Container(
            key: const Key('online-card'),
            margin: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: isOnline ? const Color(0xFFE8F5E9) : Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: isOnline ? const Color(0xFF81C784) : const Color(0xFFE0E0E0)),
            ),
            child: Row(
              children: [
                Icon(isOnline ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: isOnline ? const Color(0xFF2E7D32) : Colors.grey),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        isOnline ? context.t('You are ONLINE', 'أنت متصل') : context.t('You are OFFLINE', 'أنت غير متصل'),
                        style: TextStyle(fontWeight: FontWeight.w800, color: isOnline ? const Color(0xFF1B5E20) : const Color(0xFF424242)),
                      ),
                      Text(
                        isOnline ? context.t('You can receive new orders.', 'يمكن إسناد طلبات جديدة إليك.') : context.t('Go online to receive orders.', 'اتصل لتستقبل الطلبات.'),
                        style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B)),
                      ),
                    ],
                  ),
                ),
                Switch(
                  key: const Key('online-switch'),
                  value: isOnline,
                  onChanged: onlineAsync.isLoading ? null : (value) => ref.read(driverOnlineStateProvider.notifier).setOnline(value),
                ),
              ],
            ),
          ),
          if (onlineAsync.hasError)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(context.t('Could not update status. Please try again.', 'تعذّر تحديث حالتك. حاول مرة أخرى.'), style: TextStyle(color: Colors.red.shade700)),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(
              children: [
                KpiTile(label: context.t('Active orders', 'طلبات نشطة'), value: deliveriesAsync.valueOrNull == null ? '—' : '${deliveriesAsync.valueOrNull!.length}', emphasis: true),
                const SizedBox(width: 10),
                KpiTile(label: context.t('Delivered today', 'سُلّم اليوم'), value: deliveredToday == null ? '—' : '$deliveredToday'),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: Text('${context.t('Current shift', 'الوردية الحالية')}: ${shiftDurationLabel(shift?.periodStart, arabic: context.isArabic)}', key: const Key('orders-shift-duration'), style: const TextStyle(fontWeight: FontWeight.w600)),
            ),
          ),
          Expanded(
            child: deliveriesAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, stackTrace) => MessageView(
                icon: Icons.cloud_off_outlined,
                message: context.t('Could not load deliveries.', 'تعذّر تحميل الطلبات.'),
                hint: context.t('Check your connection.', 'تحقق من الاتصال بالإنترنت.'),
                onRetry: () => ref.invalidate(deliveriesProvider),
              ),
              data: (deliveries) {
                if (deliveries.isEmpty) {
                  return RefreshIndicator(
                    onRefresh: () async {
                      ref.invalidate(earningsProvider);
                      ref.invalidate(deliveriesProvider);
                    await ref.read(deliveriesProvider.future);
                    },
                    child: ListView(children: [
                      SizedBox(
                        height: 320,
                        child: MessageView(
                          icon: Icons.inbox_outlined,
                          message: context.t('No deliveries assigned right now.', 'لا توجد طلبات مُسندة إليك الآن.'),
                          hint: isOnline ? context.t('New orders appear here as soon as they are assigned.', 'تظهر الطلبات الجديدة هنا فور إسنادها.') : context.t('You are offline — go online to receive orders.', 'أنت غير متصل — اتصل لتستقبل الطلبات.'),
                        ),
                      ),
                    ]),
                  );
                }
                return RefreshIndicator(
                  color: orange,
                  onRefresh: () async {
                    ref.invalidate(earningsProvider);
                    ref.invalidate(deliveriesProvider);
                    await ref.read(deliveriesProvider.future);
                  },
                  child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                    itemCount: deliveries.length,
                    itemBuilder: (context, index) => _DeliveryCard(delivery: deliveries[index]),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// One assigned order: its number and state, who it is for and where, where to collect it, and any cash to take at the door.
class _DeliveryCard extends StatelessWidget {
  const _DeliveryCard({required this.delivery});

  final Delivery delivery;

  @override
  Widget build(BuildContext context) {
    final pickups = delivery.segments.map((s) => s.vendorBranchName ?? s.adHocPlaceNameSnapshot).whereType<String>().toSet().toList();
    final area = delivery.deliveryAddress.areaLabel;
    return DriverCard(
      key: Key('delivery-${delivery.id}'),
      onTap: () => context.push('/deliveries/${delivery.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(delivery.displayNumber, textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
              StatusChip(delivery.orderStatus),
            ],
          ),
          const SizedBox(height: 8),
          Row(children: [const Icon(Icons.person_outline, size: 18, color: Color(0xFF6B6B6B)), const SizedBox(width: 6), Expanded(child: Text(delivery.customerName, style: const TextStyle(fontWeight: FontWeight.w600)))]),
          if (area != null) Padding(padding: const EdgeInsets.only(top: 4), child: Row(children: [const Icon(Icons.place_outlined, size: 18, color: Color(0xFF6B6B6B)), const SizedBox(width: 6), Expanded(child: Text(area))])),
          if (pickups.isNotEmpty)
            Padding(padding: const EdgeInsets.only(top: 4), child: Row(children: [const Icon(Icons.storefront_outlined, size: 18, color: Color(0xFF6B6B6B)), const SizedBox(width: 6), Expanded(child: Text(pickups.join('، ')))])),
          if (delivery.hasCollectionOnDelivery && delivery.amountDueMinor != null)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: const Color(0xFFFFF3E8), borderRadius: BorderRadius.circular(10)),
                child: Text(context.t('Collect ${formatMinor(delivery.amountDueMinor)}', 'حصّل ${formatMinor(delivery.amountDueMinor, arabic: true)}'), style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFFE0650A))),
              ),
            ),
        ],
      ),
    );
  }
}
