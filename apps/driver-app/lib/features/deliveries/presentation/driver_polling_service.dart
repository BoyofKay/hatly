import 'dart:async';

/// M4 — Driver polling / refresh fallback. Push notifications remain the
/// primary mechanism for "you have a new/changed delivery" — this is
/// deliberately just a lightweight safety net for when a push is missed
/// (no registered device token, a dropped connection, FCM delivery
/// failure — see `PushNotificationService`'s own "existing polling
/// remains the fallback" comment on the backend).
///
/// Generic and Riverpod-agnostic on purpose — the caller supplies `onTick`
/// (see `driverPollingServiceProvider` in `driver_providers.dart`, which
/// wires it to `ref.invalidate(...)` + await the refetch). This class only
/// knows about timing and concurrency safety:
///  - `start()` is idempotent — calling it while already running never
///    creates a second, overlapping `Timer`.
///  - A tick that is still in flight when the next one is due is simply
///    skipped (never joined/parallelized) — CONFIRMED no duplicate
///    concurrent network requests.
///  - A failed tick is swallowed, never rethrown — one bad poll must never
///    crash the app or surface noisy UI; the next scheduled tick retries
///    on its own, matching `PushNotificationService`'s own
///    never-throw discipline on the backend.
class DriverPollingService {
  DriverPollingService({this.interval = const Duration(seconds: 25)});

  final Duration interval;
  Timer? _timer;
  bool _isTicking = false;

  bool get isRunning => _timer != null;

  void start(Future<void> Function() onTick) {
    if (_timer != null) return;
    _timer = Timer.periodic(interval, (_) => _tick(onTick));
  }

  Future<void> _tick(Future<void> Function() onTick) async {
    if (_isTicking) return;
    _isTicking = true;
    try {
      await onTick();
    } catch (_) {
      // Swallowed by design — see class comment.
    } finally {
      _isTicking = false;
    }
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  void dispose() => stop();
}
