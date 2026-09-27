import 'dart:io' show Platform;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../network/api_client.dart';
import '../storage/token_storage.dart';
import '../push/fcm_service.dart';
import '../../features/auth/data/device_token_api.dart';

const _defaultApiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:3000/api/v1',
);

final tokenStorageProvider = Provider<TokenStorage>((ref) => TokenStorage());

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(baseUrl: _defaultApiBaseUrl, tokenStorage: ref.watch(tokenStorageProvider));
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
      await api.register(token: token, platform: Platform.isIOS ? 'ios' : 'android');
    } catch (_) {
      // Best-effort — existing polling remains the fallback.
    }
  }

  return FcmService(onTokenReceived: register, onTokenRefreshed: register);
});