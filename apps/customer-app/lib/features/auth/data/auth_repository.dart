import '../../../core/storage/token_storage.dart';
import 'auth_api.dart';

/// Sits between the UI (OtpFlowController) and the raw API/storage
/// layers: the only place that knows both "how to call the backend"
/// and "how to persist the result".
class AuthRepository {
  AuthRepository({required AuthApi authApi, required TokenStorage tokenStorage})
      : _authApi = authApi,
        _tokenStorage = tokenStorage;

  final AuthApi _authApi;
  final TokenStorage _tokenStorage;

  Future<void> requestOtp({required String phone, required String fullName}) {
    return _authApi.requestOtp(phone: phone, fullName: fullName);
  }

  Future<void> verifyOtpAndPersistSession({
    required String phone,
    required String code,
    String? fullName,
  }) async {
    final tokens = await _authApi.verifyOtp(phone: phone, code: code);
    await _tokenStorage.saveTokens(
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    );
    // Local-only convenience cache for Home's greeting — see
    // TokenStorage.saveDisplayName for why this isn't a backend call.
    await _tokenStorage.saveDisplayName(fullName);
  }

  /// Customer Authentication Modes (master implementation) — MODE B.
  /// Same token-persistence shape as the OTP path above; the only
  /// difference is which AuthApi call produced the tokens.
  Future<void> passwordLoginAndPersistSession(
      {required String phone, required String password}) async {
    final tokens =
        await _authApi.passwordLogin(phone: phone, password: password);
    await _tokenStorage.saveTokens(
        accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
  }

  /// Covers both "genuinely new Customer" and the passwordless-
  /// existing-row attachment case — the backend alone decides which
  /// applies (see AuthApi.passwordRegister's own comment); this
  /// repository method doesn't need to know or care.
  Future<void> passwordRegisterAndPersistSession({
    required String phone,
    required String fullName,
    required String password,
  }) async {
    final tokens = await _authApi.passwordRegister(
        phone: phone, fullName: fullName, password: password);
    await _tokenStorage.saveTokens(
        accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
    await _tokenStorage.saveDisplayName(fullName);
  }

  Future<void> setPassword({required String password}) =>
      _authApi.setPassword(password: password);

  Future<void> requestPhoneVerification() =>
      _authApi.requestPhoneVerification();

  Future<void> confirmPhoneVerification({required String code}) =>
      _authApi.confirmPhoneVerification(code: code);

  Future<bool> getIsPhoneVerified() => _authApi.getIsPhoneVerified();

  Future<void> logout() async {
    try {
      await _authApi.logout();
    } catch (_) {
      // Best-effort: even if the network call fails (offline, server
      // error), we still clear local session state below so the user
      // isn't stuck "logged in" on this device with no way out.
    }
    await _tokenStorage.clear();
  }

  Future<bool> hasPersistedSession() async {
    final token = await _tokenStorage.accessToken;
    return token != null;
  }

  Future<String?> getDisplayName() => _tokenStorage.displayName;
}
