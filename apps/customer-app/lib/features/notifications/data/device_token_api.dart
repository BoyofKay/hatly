import '../../../core/network/api_client.dart';

/// Customer Push Notifications (Chunk B). Calls the real backend
/// `POST customer/device-token` (Chunk A — Role.CUSTOMER-gated,
/// ownership derived server-side from the authenticated session, see
/// that endpoint's own doc comment). This class never sends a userId
/// — the existing [ApiClient]'s auth interceptor already attaches the
/// Customer's session token to every request, which is what the
/// backend uses to identify the caller. Mirrors the Driver app's own
/// `DeviceTokenApi` exactly (apps/driver-app/lib/features/auth/data/
/// device_token_api.dart).
class DeviceTokenApi {
  DeviceTokenApi(this._apiClient);

  final ApiClient _apiClient;

  Future<void> register(
      {required String token, required String platform}) async {
    await _apiClient.dio.post(
      '/customer/device-token',
      data: {'token': token, 'platform': platform},
    );
  }
}
