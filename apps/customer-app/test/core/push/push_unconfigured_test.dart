import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/providers.dart';
import 'package:hatly_customer/core/push/fcm_service.dart';
import 'package:hatly_customer/features/auth/presentation/session_controller.dart';

import '../../support/auth_fakes.dart';

/// A Google Play closed-test build can be uploaded BEFORE the Firebase project exists (no `google-services.json`): then
/// `Firebase.initializeApp()` fails. Push must simply stay off — the customer must still be signed in, restored from storage and able to use
/// the app. This runs the REAL `FcmService` (not the no-op test double), which in a unit test is exactly an unconfigured Firebase: it throws.
void main() {
  test('the real FcmService really fails when Firebase is not configured (the premise of the tests below)', () async {
    final fcm = FcmService(onTokenReceived: (_) {}, onTokenRefreshed: (_) {});
    await expectLater(fcm.initialize(), throwsA(anything));
  });

  test('a fresh login still authenticates when Firebase is not configured', () async {
    final container = ProviderContainer(overrides: [
      ...authOverrides(FakeAuthApi(), FakeAuthTokenStorage()),
      fcmServiceProvider.overrideWith((ref) => FcmService(onTokenReceived: (_) {}, onTokenRefreshed: (_) {})),
    ]);
    addTearDown(container.dispose);
    final session = container.read(sessionControllerProvider.notifier);
    await Future<void>.delayed(Duration.zero); // let the initial restore settle (no stored session → unauthenticated)

    session.markAuthenticated(); // would throw synchronously, or surface an unhandled async error, if push failures leaked
    expect(container.read(sessionControllerProvider).status, SessionStatus.authenticated);
    await Future<void>.delayed(const Duration(milliseconds: 200)); // the failing initialize() runs now; an unhandled error would fail the test
    expect(container.read(sessionControllerProvider).status, SessionStatus.authenticated);
  });

  test('a restored session (app cold start with stored tokens) stays signed in when Firebase is not configured', () async {
    final storage = FakeAuthTokenStorage()
      ..access = 'stored-access'
      ..refresh = 'stored-refresh';
    final container = ProviderContainer(overrides: [
      ...authOverrides(FakeAuthApi(), storage),
      fcmServiceProvider.overrideWith((ref) => FcmService(onTokenReceived: (_) {}, onTokenRefreshed: (_) {})),
    ]);
    addTearDown(container.dispose);
    container.read(sessionControllerProvider);
    await Future<void>.delayed(const Duration(milliseconds: 200));
    expect(container.read(sessionControllerProvider).status, SessionStatus.authenticated);
  });
}
