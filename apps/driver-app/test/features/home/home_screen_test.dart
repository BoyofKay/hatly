import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_driver/features/deliveries/data/driver_api.dart';
import 'package:hatly_driver/features/deliveries/data/driver_providers.dart';
import 'package:hatly_driver/features/deliveries/domain/delivery.dart';
import 'package:hatly_driver/features/earnings/domain/earnings.dart';
import 'package:hatly_driver/features/deliveries/presentation/driver_location_service.dart';
import 'package:hatly_driver/features/deliveries/presentation/driver_polling_service.dart';
import 'package:hatly_driver/features/home/presentation/home_screen.dart';

/// Driver Core + Dispatch Foundation milestone. `HomeScreen` was implemented (availability toggle +
/// assigned-deliveries list) without a dedicated test — this closes that gap. Reuses the exact
/// `FakeDriverApi` shape `delivery_detail_screen_test.dart` already establishes for this app.
class FakeDriverApi implements DriverApi {
  @override
  Future<Delivery> acknowledgeDelivery(String id) async => throw UnimplementedError();

  @override
  Future<String?> getOperationsPhone() async => null;

  FakeDriverApi({this.deliveries = const [], this.setOnlineError, this.serverOnline});

  /// What GET /driver/online-status answers (null = unreadable / older backend).
  bool? serverOnline;
  int onlineStatusReads = 0;

  @override
  Future<String?> getProfileName() async => 'Test driver';

  @override
  Future<bool?> getOnlineStatus() async {
    onlineStatusReads++;
    return serverOnline;
  }

  List<Delivery> deliveries;
  Object? setOnlineError;
  final onlineStatusCalls = <bool>[];

  @override
  Future<List<Delivery>> listDeliveries() async => deliveries;

  @override
  Future<DriverEarnings> getEarnings() async => throw UnimplementedError();

  @override
  Future<TransactionsPage> getTransactions({int page = 1, int limit = 20, String? scope}) async => throw UnimplementedError();

  @override
  Future<T> retryTransient<T>(Future<T> Function() op, {int attempts = 3, Duration pause = const Duration(milliseconds: 800)}) => op();

  @override
  Future<Delivery> getDelivery(String id) async => deliveries.firstWhere((d) => d.id == id);

  @override
  Future<void> setOnlineStatus(bool isOnline) async {
    onlineStatusCalls.add(isOnline);
    if (setOnlineError != null) throw setOnlineError!;
  }

  @override
  Future<void> updateDeliveryStatus(
    String deliveryId,
    String status, {
    DriverFailedDeliveryReason? failureReason,
    String? proofPhotoUrl,
    String? recipientName,
  }) async {}

  @override
  Future<void> updateLocation({required double latitude, required double longitude}) async {}

  @override
  Future<void> recordWeight(String orderItemId, int weightGrams) async {}

  @override
  Future<void> recordPurchaseAmount(String orderItemId, int amountMinor) async {}

  @override
  Future<String> uploadProofPhoto(List<int> bytes, String filename) async => 'https://hatly.example/uploads/unused.jpg';

  @override
  Future<void> submitCashRemainder(String deliveryId, int cashReceivedMinor) async {}
}

/// A no-op double — the real service starts a periodic `Timer` calling the real `Geolocator`
/// plugin, which has no platform channel registered in a widget test.
class FakeLocationService extends DriverLocationService {
  bool started = false;
  bool stopped = false;

  @override
  void start(void Function(Position) onLocation) {
    started = true;
  }

  @override
  void stop() {
    stopped = true;
  }
}

/// M4 — same no-op-double reasoning as `FakeLocationService`: the real
/// `DriverPollingService` starts a genuine `Timer.periodic`, which a widget
/// test must never leave running past the test (flutter_test fails a test
/// that still has a pending Timer at teardown).
class FakePollingService extends DriverPollingService {
  int startCalls = 0;
  int stopCalls = 0;
  Future<void> Function()? capturedOnTick;

  @override
  void start(Future<void> Function() onTick) {
    startCalls++;
    capturedOnTick = onTick;
  }

  @override
  void stop() {
    stopCalls++;
  }

  @override
  bool get isRunning => startCalls > stopCalls;
}

Delivery _delivery(String id, String orderId, String customerName, String status) {
  return Delivery(
    id: id,
    orderId: orderId,
    orderStatus: status,
    fulfillmentType: 'DELIVERY',
    paymentMethod: 'COD',
    totalMinor: 5000,
    amountDueMinor: 5000,
    customerName: customerName,
    customerPhone: '+201000000001',
    deliveryAddress: const DeliveryAddress(line1: '1 Test St', latitude: 30.1, longitude: 31.2),
    segments: const [],
  );
}

Future<(FakeDriverApi, FakeLocationService, FakePollingService)> pump(WidgetTester tester, {List<Delivery> deliveries = const [], FakeDriverApi? api}) async {
  final fakeApi = api ?? FakeDriverApi(deliveries: deliveries);
  final fakeLocation = FakeLocationService();
  final fakePolling = FakePollingService();
  final router = GoRouter(routes: [
    GoRoute(path: '/', builder: (context, state) => const HomeScreen()),
    GoRoute(path: '/deliveries/:id', builder: (context, state) => Scaffold(body: Text('Detail ${state.pathParameters['id']}'))),
  ]);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        driverApiProvider.overrideWithValue(fakeApi),
        driverLocationServiceProvider.overrideWithValue(fakeLocation),
        driverPollingServiceProvider.overrideWithValue(fakePolling),
      ],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
  return (fakeApi, fakeLocation, fakePolling);
}

void main() {
  group('active orders (2026-11-13)', () {
    test('only assigned / picked up / on the way are active — delivered, cancelled, failed, collected and released orders are not', () {
      for (final st in ['ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY']) {
        expect(Delivery.activeStatuses.contains(st), isTrue, reason: st);
      }
      for (final st in ['DELIVERED', 'CANCELLED', 'FAILED_DELIVERY', 'COLLECTED', 'READY_FOR_PICKUP', 'PENDING']) {
        expect(Delivery.activeStatuses.contains(st), isFalse, reason: st);
      }
    });
  });

  group('online switch follows the server (2026-11-15)', () {
    testWidgets('reopening the app while the server still has the driver online shows ONLINE and restarts the location timer', (tester) async {
      final api = FakeDriverApi(serverOnline: true);
      final (_, fakeLocation, _) = await pump(tester, api: api);
      expect(api.onlineStatusReads, greaterThanOrEqualTo(1));
      expect(find.text('You are ONLINE'), findsOneWidget);
      expect(tester.widget<Switch>(find.byType(Switch)).value, isTrue);
      expect(fakeLocation.started, isTrue);
      expect(api.onlineStatusCalls, isEmpty); // reading never changes the server's switch
    });

    testWidgets('an unreadable status (older backend / no network) keeps OFFLINE and starts nothing', (tester) async {
      final api = FakeDriverApi(serverOnline: null);
      final (_, fakeLocation, _) = await pump(tester, api: api);
      expect(find.text('You are OFFLINE'), findsOneWidget);
      expect(fakeLocation.started, isFalse);
    });

    testWidgets('coming back to the front re-reads the status (switched offline elsewhere → OFFLINE, timer stopped)', (tester) async {
      final api = FakeDriverApi(serverOnline: true);
      final (_, fakeLocation, _) = await pump(tester, api: api);
      expect(find.text('You are ONLINE'), findsOneWidget);
      api.serverOnline = false;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('You are OFFLINE'), findsOneWidget);
      expect(fakeLocation.stopped, isTrue);
    });
  });

  group('Driver Core + Dispatch Foundation milestone — Home (availability + assigned deliveries)', () {
    testWidgets('starts OFFLINE, with no location timer running', (tester) async {
      final (_, fakeLocation, fakePolling) = await pump(tester);
      expect(find.text('You are OFFLINE'), findsOneWidget);
      expect(find.byType(Switch), findsOneWidget);
      expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);
      expect(fakeLocation.started, isFalse);
      // M4 — polling itself is independent of online/offline: it starts on
      // mount regardless, since "assigned deliveries" can change server-side
      // (e.g. an Admin reassignment) even while this driver is offline.
      expect(fakePolling.startCalls, 1);
    });

    testWidgets('toggling online calls the real online-status endpoint and starts the location timer only after it succeeds', (tester) async {
      final (fakeApi, fakeLocation, _) = await pump(tester);

      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();

      expect(fakeApi.onlineStatusCalls, [true]);
      expect(find.text('You are ONLINE'), findsOneWidget);
      expect(fakeLocation.started, isTrue);
    });

    testWidgets('a failed online-status call shows an error, the switch reverts, and the location timer never starts', (tester) async {
      final fakeApi = FakeDriverApi(setOnlineError: Exception('network down'));
      final fakeLocation = FakeLocationService();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            driverApiProvider.overrideWithValue(fakeApi),
            driverLocationServiceProvider.overrideWithValue(fakeLocation),
            driverPollingServiceProvider.overrideWithValue(FakePollingService()),
          ],
          child: const MaterialApp(home: HomeScreen()),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();

      expect(find.text('Could not update status. Please try again.'), findsOneWidget);
      expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);
      expect(fakeLocation.started, isFalse);
    });

    testWidgets('an empty assignment list shows the empty state, never a spinner stuck forever', (tester) async {
      await pump(tester, deliveries: []);
      expect(find.text('No deliveries assigned right now.'), findsOneWidget);
    });

    testWidgets('assigned deliveries render as a list; tapping one navigates to its detail route', (tester) async {
      await pump(tester, deliveries: [
        _delivery('delivery-1', 'order-11111111-aaaa-4444-bbbb-222222222222', 'Jane Customer', 'ASSIGNED_TO_DRIVER'),
        _delivery('delivery-2', 'order-22222222-aaaa-4444-bbbb-333333333333', 'John Customer', 'PICKED_UP'),
      ]);

      expect(find.text('Jane Customer'), findsOneWidget);
      expect(find.text('Assigned'), findsOneWidget);
      expect(find.text('John Customer'), findsOneWidget);
      expect(find.text('Picked up'), findsOneWidget);

      await tester.tap(find.text('Jane Customer'));
      await tester.pumpAndSettle();
      expect(find.text('Detail delivery-1'), findsOneWidget);
    });

    testWidgets('a failed deliveries fetch shows a retry affordance, never a silent blank screen', (tester) async {
      final fakeApi = _ThrowingListDriverApi();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            driverApiProvider.overrideWithValue(fakeApi),
            driverLocationServiceProvider.overrideWithValue(FakeLocationService()),
            driverPollingServiceProvider.overrideWithValue(FakePollingService()),
          ],
          child: const MaterialApp(home: HomeScreen()),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Could not load deliveries.'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });
  });

  group('M4 — Driver polling / refresh fallback', () {
    testWidgets('starts polling once on mount', (tester) async {
      final (_, _, fakePolling) = await pump(tester);
      expect(fakePolling.startCalls, 1);
      expect(fakePolling.stopCalls, 0);
    });

    testWidgets('a poll tick refreshes the assigned-deliveries list', (tester) async {
      final (fakeApi, _, fakePolling) = await pump(tester, deliveries: [
        _delivery('delivery-1', 'order-11111111-aaaa-4444-bbbb-222222222222', 'Jane Customer', 'ASSIGNED_TO_DRIVER'),
      ]);
      expect(find.text('Assigned'), findsOneWidget);

      // Simulate the backend advancing the delivery, then fire the captured tick
      // exactly as the real DriverPollingService would.
      fakeApi.deliveries = [
        _delivery('delivery-1', 'order-11111111-aaaa-4444-bbbb-222222222222', 'Jane Customer', 'PICKED_UP'),
      ];
      await fakePolling.capturedOnTick!();
      await tester.pumpAndSettle();

      expect(find.text('Picked up'), findsOneWidget);
    });

    testWidgets('pausing the app (backgrounded) stops polling; resuming starts it again', (tester) async {
      final (_, _, fakePolling) = await pump(tester);
      expect(fakePolling.startCalls, 1);

      final binding = TestWidgetsFlutterBinding.ensureInitialized();
      binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pumpAndSettle();
      expect(fakePolling.stopCalls, greaterThanOrEqualTo(1));

      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(fakePolling.startCalls, greaterThanOrEqualTo(2));
    });
  });
}

class _ThrowingListDriverApi extends FakeDriverApi {
  @override
  Future<List<Delivery>> listDeliveries() async => throw Exception('server unavailable');
}
