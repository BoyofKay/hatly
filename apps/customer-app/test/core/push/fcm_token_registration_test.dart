import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/api_client.dart';
import 'package:hatly_customer/core/network/providers.dart';
import 'package:hatly_customer/core/storage/token_storage.dart';

/// Push Notification token lifecycle (Phase 3). `fcmServiceProvider`'s
/// registration closure (providers.dart) is what both
/// `onTokenReceived` (first token) and `onTokenRefreshed` (Firebase
/// rotates the token) call — CONFIRMED (pre-existing, unchanged) to be
/// the exact same function, so a single token-refresh event is
/// registered through the identical, already-tested path as first
/// registration. This test's real subject is the explicit
/// requirement that "Firebase/provider failures degrade gracefully"
/// and "notification registration failures do not break login or app
/// startup" — exercised here with a REAL `ApiClient` pointed at a
/// port nothing listens on, so the POST genuinely fails at the
/// network layer, not a mocked exception.
void main() {
  test('a device-token registration failure (real network error) never throws', () async {
    final container = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(ApiClient(
        baseUrl: 'http://127.0.0.1:1/api/v1',
        tokenStorage: TokenStorage(),
      )),
    ]);
    addTearDown(container.dispose);

    final fcmService = container.read(fcmServiceProvider);

    // Fire-and-forget, exactly as FcmService.initialize() itself calls
    // these (see that class: `onTokenReceived(token)` /
    // `onTokenRefresh.listen(onTokenRefreshed)`) — neither call is
    // awaited by the caller, so the only way a failure here could ever
    // reach the app is as an unhandled async error, which this test
    // would surface via tester/zone error reporting.
    expect(() => fcmService.onTokenReceived('a-device-token'), returnsNormally);
    expect(() => fcmService.onTokenRefreshed('a-rotated-device-token'), returnsNormally);

    // Give the fire-and-forget network call a chance to actually fail
    // and hit its own try/catch (providers.dart's `register` closure)
    // before the test ends — an uncaught async error surfacing after
    // the test completes would still fail it via Flutter's own
    // uncaught-error test reporting.
    await Future<void>.delayed(const Duration(milliseconds: 300));
  });
}
