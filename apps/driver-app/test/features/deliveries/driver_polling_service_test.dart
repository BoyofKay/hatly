import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/features/deliveries/presentation/driver_polling_service.dart';

/// M4 — Driver polling / refresh fallback. Real, short `Timer.periodic`
/// intervals + real async waits (no fake-clock package in this project) —
/// every test explicitly `stop()`s its service before finishing so no Timer
/// is ever left pending past the test.
void main() {
  group('DriverPollingService', () {
    test('start/stop: isRunning reflects the real timer state', () async {
      final service = DriverPollingService(interval: const Duration(milliseconds: 20));
      expect(service.isRunning, isFalse);

      service.start(() async {});
      expect(service.isRunning, isTrue);

      service.stop();
      expect(service.isRunning, isFalse);
    });

    test('CRITICAL: calling start() twice never creates a second, overlapping timer', () async {
      final service = DriverPollingService(interval: const Duration(milliseconds: 20));
      var ticks = 0;
      service.start(() async => ticks++);
      service.start(() async => ticks++); // second call — must be a no-op

      await Future<void>.delayed(const Duration(milliseconds: 65));
      service.stop();

      // ~3 ticks expected for one timer over 65ms/20ms; a duplicate timer would
      // roughly double this count.
      expect(ticks, lessThan(5));
    });

    test('successful refresh: onTick is invoked repeatedly on the given interval', () async {
      final service = DriverPollingService(interval: const Duration(milliseconds: 15));
      var ticks = 0;
      service.start(() async => ticks++);

      await Future<void>.delayed(const Duration(milliseconds: 70));
      service.stop();

      expect(ticks, greaterThanOrEqualTo(3));
    });

    test('CRITICAL: a failed tick is swallowed — never crashes, never stops the timer, the next tick still fires', () async {
      final service = DriverPollingService(interval: const Duration(milliseconds: 15));
      var attempts = 0;
      service.start(() async {
        attempts++;
        throw Exception('simulated network failure');
      });

      await Future<void>.delayed(const Duration(milliseconds: 70));
      service.stop();

      expect(attempts, greaterThanOrEqualTo(3)); // kept retrying despite every attempt throwing
    });

    test('CRITICAL: duplicate-prevention — a slow tick still in flight is never joined by an overlapping second call', () async {
      final service = DriverPollingService(interval: const Duration(milliseconds: 10));
      var concurrentInFlight = 0;
      var maxConcurrent = 0;
      var completedTicks = 0;

      service.start(() async {
        concurrentInFlight++;
        maxConcurrent = concurrentInFlight > maxConcurrent ? concurrentInFlight : maxConcurrent;
        await Future<void>.delayed(const Duration(milliseconds: 40)); // slower than the interval
        concurrentInFlight--;
        completedTicks++;
      });

      await Future<void>.delayed(const Duration(milliseconds: 100));
      service.stop();

      expect(maxConcurrent, 1); // never more than one tick in flight at a time
      expect(completedTicks, greaterThanOrEqualTo(1));
    });

    test('dispose() stops the timer, same as stop()', () async {
      final service = DriverPollingService(interval: const Duration(milliseconds: 20));
      service.start(() async {});
      expect(service.isRunning, isTrue);

      service.dispose();
      expect(service.isRunning, isFalse);
    });

    test('stop() before any start() is a safe no-op', () {
      final service = DriverPollingService();
      expect(() => service.stop(), returnsNormally);
      expect(service.isRunning, isFalse);
    });

    test('state changes: start after stop resumes ticking (e.g. app foregrounded again)', () async {
      final service = DriverPollingService(interval: const Duration(milliseconds: 15));
      var ticks = 0;
      service.start(() async => ticks++);
      await Future<void>.delayed(const Duration(milliseconds: 40));
      service.stop();
      final ticksWhileRunning = ticks;
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(ticks, ticksWhileRunning); // confirmed stopped — no ticks while stopped

      service.start(() async => ticks++);
      await Future<void>.delayed(const Duration(milliseconds: 40));
      service.stop();
      expect(ticks, greaterThan(ticksWhileRunning)); // resumed
    });
  });
}
