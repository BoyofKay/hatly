import '../../../core/network/api_client.dart';
import '../../../core/storage/token_storage.dart';

/// CONFIRMED (locked decision): Driver login is phone/username +
/// password ONLY — no OTP anywhere in this app. Calls the real
/// backend `POST auth/driver/login` (Phase I-A, Chunk 5 backend
/// addition) — a separate endpoint from the Customer/Admin OTP flow,
/// so neither of those is touched by this class.
class DriverAuthApi {
  DriverAuthApi(this._apiClient, this._tokenStorage);

  final ApiClient _apiClient;
  final TokenStorage _tokenStorage;

  /// Throws [DioException] (via the underlying Dio call) on invalid
  /// credentials (generic message from the backend, by design — never
  /// distinguishes wrong phone from wrong password) or network
  /// failure. On success, persists both tokens via the existing
  /// [TokenStorage] — the same storage the rest of the app already
  /// relies on for session restore.
  /// Returns true when the password was a TEMPORARY one set by Hatly operations — the driver must choose a new one first.
  Future<bool> login({required String phone, required String password}) async {
    final response = await _apiClient.dio.post(
      '/auth/driver/login',
      data: {'phone': phone, 'password': password},
    );
    final data = response.data['data'] as Map<String, dynamic>;
    await _tokenStorage.saveTokens(
      accessToken: data['accessToken'] as String,
      refreshToken: data['refreshToken'] as String,
    );
    return data['mustChangePassword'] == true;
  }

  /// The driver's own password change (`POST auth/driver/password`). Throws [DioException] on a refusal
  /// (CURRENT_PASSWORD_INVALID, PASSWORD_UNCHANGED, WEAK_PASSWORD, …).
  Future<void> changePassword({required String currentPassword, required String newPassword}) async {
    await _apiClient.dio.post('/auth/driver/password', data: {'currentPassword': currentPassword, 'newPassword': newPassword});
  }
}
