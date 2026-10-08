import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'dart:io' show Platform;
import '../config/api_config.dart';
import '../network/api_client.dart';
import '../storage/token_storage.dart';
import '../push/fcm_service.dart';
import '../push/notification_navigation_coordinator.dart';
import '../../features/auth/presentation/session_controller.dart';
import '../../features/notifications/data/device_token_api.dart';

final tokenStorageProvider = Provider<TokenStorage>((ref) => TokenStorage());

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    baseUrl: kApiBaseUrl,
    tokenStorage: ref.watch(tokenStorageProvider),
    // Only invoked later, when a request's refresh attempt ultimately
    // fails — not during provider construction, so this doesn't create
    // an init-time cycle with sessionControllerProvider.
    onSessionExpired: () =>
        ref.read(sessionControllerProvider.notifier).forceLogout(),
  );
});

/// Customer Push Notifications (Chunk B). A single shared instance —
/// see FcmService's own top comment for why this must never be
/// constructed more than once. Token registration is wired here (the
/// one place with clean access to `apiClientProvider`), mirroring the
/// Driver app's own `fcmServiceProvider` exactly
/// (apps/driver-app/lib/core/network/providers.dart); tap-navigation
/// (`onNotificationTapped`) is assigned separately by the app root
/// once the router exists (see main.dart).
final fcmServiceProvider = Provider<FcmService>((ref) {
  Future<void> register(String token) async {
    try {
      final api = DeviceTokenApi(ref.read(apiClientProvider));
      await api.register(
          token: token, platform: Platform.isIOS ? 'ios' : 'android');
    } catch (_) {
      // Best-effort — same convention as Driver's own registration
      // callback: a Customer without push registered simply never
      // receives one, which must never block or fail auth/session.
    }
  }

  return FcmService(onTokenReceived: register, onTokenRefreshed: register);
});

/// Push Notification Deep Links. A single shared instance — the
/// pending-intent state (see the coordinator's own comment) must
/// survive across the app's lifetime, not be recreated per rebuild.
/// `navigate` is assigned once by the app root once the router exists
/// (main.dart), mirroring `fcmServiceProvider.onNotificationTapped`'s
/// own "assigned late" shape exactly.
///
/// The `ref.listen` below reacts to a genuine transition INTO
/// `authenticated` (both a fresh login and a restored session end up
/// here — `SessionController` sets that status for both, see its own
/// comment) to flush any notification tap that arrived before the
/// session was ready — mirrors the existing `_SessionListenable`
/// pattern in `app_router.dart` (a plain class holding `ref` and
/// calling `ref.listen` from within a Provider's own build), the
/// established way this codebase reacts to session-status changes
/// outside a widget.
final notificationNavigationProvider =
    Provider<NotificationNavigationCoordinator>((ref) {
  final coordinator = NotificationNavigationCoordinator(
    isAuthenticated: () =>
        ref.read(sessionControllerProvider).status ==
        SessionStatus.authenticated,
  );
  ref.listen<SessionState>(sessionControllerProvider, (previous, next) {
    final wasAuthenticated = previous?.status == SessionStatus.authenticated;
    if (!wasAuthenticated && next.status == SessionStatus.authenticated) {
      coordinator.onAuthenticated();
    }
  });
  return coordinator;
});
