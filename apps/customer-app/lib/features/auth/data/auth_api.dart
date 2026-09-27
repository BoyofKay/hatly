import '../../../core/network/api_client.dart';

/// Token pair returned by /auth/otp/verify and /auth/refresh.
class AuthTokens {
  const AuthTokens({required this.accessToken, required this.refreshToken});
  final String accessToken;
  final String refreshToken;

  factory AuthTokens.fromJson(Map<String, dynamic> json) {
    return AuthTokens(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
    );
  }
}

/// Thin wrapper over the existing backend auth endpoints — no new API
/// surface is introduced here, only typed Dart calls onto the contract
/// documented in hatly-api-contract.md.
///
/// Design note: this app calls `/auth/register` for BOTH new and
/// returning customers (not `/auth/login`). The backend's
/// `requestRegistrationOtp` already only creates a user if one doesn't
/// exist yet, and always sends an OTP — so this one call correctly
/// covers "new customer" and "returning customer" alike, using only
/// the endpoints the backend already exposes and without leaking
/// which case it was (both return the same generic message). The
/// tradeoff — a returning customer re-enters their name on every
/// login — is called out as a known UX limitation in the Phase 2A
/// report rather than solved by adding a new backend endpoint.
class AuthApi {
  AuthApi(this._client);

  final ApiClient _client;

  Future<void> requestOtp({required String phone, required String fullName}) {
    return _client.request(
      (dio) => dio
          .post('/auth/register', data: {'phone': phone, 'fullName': fullName}),
      (_) => null,
    );
  }

  Future<AuthTokens> verifyOtp({required String phone, required String code}) {
    return _client.request(
      (dio) =>
          dio.post('/auth/otp/verify', data: {'phone': phone, 'code': code}),
      (data) => AuthTokens.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Customer Authentication Modes (master implementation) — MODE B.
  /// Calling `requestOtp` above when OTP is OFF throws an
  /// `ApiException` whose `businessCode == 'CUSTOMER_OTP_DISABLED'` —
  /// that's the signal the flow controller uses to switch to these
  /// password-mode calls instead.
  Future<AuthTokens> passwordLogin(
      {required String phone, required String password}) {
    return _client.request(
      (dio) => dio.post('/auth/customer/password/login',
          data: {'phone': phone, 'password': password}),
      (data) => AuthTokens.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Same endpoint/call for BOTH a genuinely new Customer AND the
  /// passwordless-existing-row attachment case — the backend decides
  /// which applies; the client never needs to know or ask.
  Future<AuthTokens> passwordRegister(
      {required String phone,
      required String fullName,
      required String password}) {
    return _client.request(
      (dio) => dio.post(
        '/auth/customer/password/register',
        data: {'phone': phone, 'fullName': fullName, 'password': password},
      ),
      (data) => AuthTokens.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Authenticated password setup/change — requires a valid session
  /// (the existing ApiClient auth interceptor attaches it automatically).
  Future<void> setPassword({required String password}) {
    return _client.request(
      (dio) =>
          dio.patch('/auth/customer/password', data: {'password': password}),
      (_) => null,
    );
  }

  /// Authenticated, post-login, non-blocking phone verification.
  Future<void> requestPhoneVerification() {
    return _client.request(
        (dio) => dio.post('/auth/customer/verify-phone/request'), (_) => null);
  }

  Future<void> confirmPhoneVerification({required String code}) {
    return _client.request(
      (dio) =>
          dio.post('/auth/customer/verify-phone/confirm', data: {'code': code}),
      (_) => null,
    );
  }

  /// Backs the dismissible post-login phone-verification prompt — the
  /// only way the client can know whether the current session is
  /// phone-verified (the JWT payload never carried this).
  Future<bool> getIsPhoneVerified() {
    return _client.request(
      (dio) => dio.get('/auth/customer/me'),
      (data) =>
          (data['data'] as Map<String, dynamic>)['isPhoneVerified'] as bool,
    );
  }

  Future<void> logout() {
    return _client.request((dio) => dio.post('/auth/logout'), (_) => null);
  }
}
