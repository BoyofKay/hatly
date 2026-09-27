import '../../../core/network/api_client.dart';

/// Driver Push Notifications. Calls the real backend
/// `POST driver/device-token` (Role.DRIVER-gated, ownership derived
/// server-side from the authenticated session — see that endpoint's
/// own doc comment). This class never sends a userId — the existing
/// [ApiClient]'s auth interceptor already attaches the Driver's
/// session token to every request, which is what the backend uses.
class DeviceTokenApi {
  DeviceTokenApi(this._apiClient);

  final ApiClient _apiClient;

  Future<void> register({required String token, required String platform}) async {
    await _apiClient.dio.post(
      '/driver/device-token',
      data: {'token': token, 'platform': platform},
    );
  }
}
