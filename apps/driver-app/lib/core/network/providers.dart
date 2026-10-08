import 'dart:io' show Platform;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/api_config.dart';
import '../network/api_client.dart';
import '../storage/token_storage.dart';
import '../push/fcm_service.dart';
import '../../features/auth/data/device_token_api.dart';
import '../../features/auth/presentation/auth_state_provider.dart';
import '../../features/deliveries/data/driver_providers.dart';

final tokenStorageProvider = Provider<TokenStorage>((ref) => TokenStorage());

final Provider<ApiClient> apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    baseUrl: kApiBaseUrl,
    tokenStorage: ref.watch(tokenStorageProvider),
    // M4 — Session / device safety. Fires on ANY irrecoverable 401 from ANY
    // API call (not just an explicit logout tap) — mirrors HomeScreen's own
    // logout button sequence exactly (stop GPS → clear auth state), so a
    // session that goes invalid mid-use (e.g. revoked by a login elsewhere,
    // since refresh-token rotation is per-user, not per-device — see
    // RefreshTokenStore) can never leave the driver looking at stale
    // assignment/status data under a session that no longer exists.
    onSessionExpired: () {
      ref.read(driverOnlineStateProvider.notifier).resetOnLogout();
      ref.read(authStateProvider.notifier).logout();
    },
  );
});

/// Driver Push Notifications. A single shared instance — see
/// FcmService's own top comment for why this must never be
/// constructed more than once. Token registration is wired here (the
/// one place with clean access to `apiClientProvider`); tap-navigation
/// (`onNotificationTapped`) is assigned separately by the app root
/// once the router exists (see main.dart).
final fcmServiceProvider = Provider<FcmService>((ref) {
  Future<void> register(String token) async {
    try {
      final api = DeviceTokenApi(ref.read(apiClientProvider));
      await api.register(
          token: token, platform: Platform.isIOS ? 'ios' : 'android');
    } catch (_) {
      // Best-effort — existing polling remains the fallback.
    }
  }

  return FcmService(onTokenReceived: register, onTokenRefreshed: register);
});
