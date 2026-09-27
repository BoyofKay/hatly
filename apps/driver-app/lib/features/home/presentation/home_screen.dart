import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../auth/presentation/auth_state_provider.dart';
import '../../deliveries/data/driver_providers.dart';
import '../../deliveries/domain/delivery.dart';

/// Real Driver Home — online/offline toggle (wired to the real
/// `PATCH driver/online-status` + the GPS timer, see
/// DriverOnlineStateNotifier) and the assigned-delivery list (real
/// `GET driver/deliveries`). CONFIRMED (locked decision): no
/// Accept/Reject anywhere — a delivery already appearing here means
/// it has already been assigned, by the system or by Admin.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final onlineAsync = ref.watch(driverOnlineStateProvider);
    final deliveriesAsync = ref.watch(deliveriesProvider);
    final isOnline = onlineAsync.valueOrNull ?? false;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Hatly Driver'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
              ref.read(driverOnlineStateProvider.notifier).resetOnLogout();
              await ref.read(authStateProvider.notifier).logout();
            },
          ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            color: isOnline ? Colors.green.shade50 : Colors.grey.shade100,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  isOnline ? 'You are ONLINE' : 'You are OFFLINE',
                  style: TextStyle(fontWeight: FontWeight.bold, color: isOnline ? Colors.green.shade800 : Colors.grey.shade700),
                ),
                Switch(
                  value: isOnline,
                  onChanged: onlineAsync.isLoading
                      ? null
                      : (value) => ref.read(driverOnlineStateProvider.notifier).setOnline(value),
                ),
              ],
            ),
          ),
          if (onlineAsync.hasError)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text('Could not update status. Please try again.', style: TextStyle(color: Colors.red.shade700)),
            ),
          Expanded(
            child: deliveriesAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, stackTrace) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Could not load deliveries.'),
                    TextButton(onPressed: () => ref.invalidate(deliveriesProvider), child: const Text('Retry')),
                  ],
                ),
              ),
              data: (deliveries) {
                if (deliveries.isEmpty) {
                  return const Center(child: Text('No deliveries assigned right now.'));
                }
                return RefreshIndicator(
                  onRefresh: () => ref.refresh(deliveriesProvider.future),
                  child: ListView.separated(
                    itemCount: deliveries.length,
                    separatorBuilder: (context, index) => const Divider(height: 1),
                    itemBuilder: (context, index) => _DeliveryTile(delivery: deliveries[index]),
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

class _DeliveryTile extends StatelessWidget {
  const _DeliveryTile({required this.delivery});

  final Delivery delivery;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text('Order #${delivery.orderId.substring(0, 8)}'),
      subtitle: Text('${delivery.customerName} · ${delivery.orderStatus}'),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => context.push('/deliveries/${delivery.id}'),
    );
  }
}
