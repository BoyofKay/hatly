import '../../../core/storage/token_storage.dart';
import 'auth_api.dart';

/// Sits between the UI (the auth flow controller) and the raw API/storage
/// layers: the only place that knows both "how to call the backend"
/// and "how to persist the result".
class AuthRepository {
  AuthRepository({required AuthApi authApi, required TokenStorage tokenStorage})
      : _authApi = authApi,
        _tokenStorage = tokenStorage;

  final AuthApi _authApi;
  final TokenStorage _tokenStorage;

  /// Phone + password sign-in: persists the tokens. It does NOT mark the session authenticated — the caller (the flow
  /// controller) does that, so a registration can finish its phone-verification step first.
  /// Returns true when the password was a temporary one (set by Hatly) that must be changed before anything else.
  Future<bool> passwordLoginAndPersistSession(
      {required String phone, required String password}) async {
    final tokens =
        await _authApi.passwordLogin(phone: phone, password: password);
    await _tokenStorage.saveTokens(
        accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
    return tokens.mustChangePassword;
  }

  Future<void> requestRegistrationCode({required String phone}) =>
      _authApi.requestRegistrationCode(phone: phone);

  /// Registration for a phone that has no account (see AuthApi.passwordRegister).
  Future<void> passwordRegisterAndPersistSession({
    required String phone,
    required String fullName,
    required String password,
    String? code,
  }) async {
    final tokens = await _authApi.passwordRegister(
        phone: phone, fullName: fullName, password: password, code: code);
    await _tokenStorage.saveTokens(
        accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
    await _tokenStorage.saveDisplayName(fullName);
  }

  Future<void> setPassword(
          {required String password, String? currentPassword}) =>
      _authApi.setPassword(
          password: password, currentPassword: currentPassword);

  Future<void> requestPhoneVerification() =>
      _authApi.requestPhoneVerification();

  Future<void> confirmPhoneVerification({required String code}) =>
      _authApi.confirmPhoneVerification(code: code);

  Future<PhoneVerificationStatus> getPhoneVerificationStatus() =>
      _authApi.getPhoneVerificationStatus();

  /// Account deletion already ended the server-side session, so — unlike [logout] — nothing is sent afterwards: only the local
  /// tokens are cleared. A failed deletion throws and leaves the session untouched.
  Future<void> deleteAccount({required String password}) async {
    await _authApi.deleteAccount(password: password);
    await _tokenStorage.clear();
  }

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
