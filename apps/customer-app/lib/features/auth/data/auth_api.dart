import '../../../core/network/api_client.dart';

/// `GET auth/customer/me`: is the phone verified, and can it be verified right now (the server's `CUSTOMER_OTP_ENABLED`).
/// With OTP off an unverified phone simply stays unverified — nothing is faked and nothing is asked of the customer.
class PhoneVerificationStatus {
  const PhoneVerificationStatus(
      {required this.isVerified, required this.available});

  final bool isVerified;
  final bool available;

  /// The prompt ("verify your phone") is only worth showing when it can be acted on.
  bool get shouldPrompt => !isVerified && available;
}

/// Token pair returned by the customer password endpoints.
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

/// Thin wrapper over the existing backend customer auth endpoints — no new API
/// surface is introduced here, only typed Dart calls onto the contract
/// documented in hatly-api-contract.md.
///
/// Sign-in is ALWAYS phone + password. The OTP-login endpoints (`/auth/register`, `/auth/login`, `/auth/otp/verify`) are
/// deliberately NOT wrapped: OTP is only used to verify a phone number during registration, through the authenticated
/// `/auth/customer/verify-phone/*` calls below — never to sign anyone in.
class AuthApi {
  AuthApi(this._client);

  final ApiClient _client;

  /// Phone + password sign-in. Works whether `CUSTOMER_OTP_ENABLED` is on or off and whether or not the phone is verified —
  /// the setting never gates or invalidates a password account.
  Future<AuthTokens> passwordLogin(
      {required String phone, required String password}) {
    return _client.request(
      (dio) => dio.post('/auth/customer/password/login',
          data: {'phone': phone, 'password': password}),
      (data) => AuthTokens.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Registration step 1 while the backend has OTP on: texts a code to the phone being registered (the same answer for every
  /// phone). Fails with `CUSTOMER_OTP_DISABLED` while OTP is off — then no code is needed and [passwordRegister] works with the
  /// password alone.
  Future<void> requestRegistrationCode({required String phone}) {
    return _client.request(
      (dio) => dio
          .post('/auth/customer/register/request-code', data: {'phone': phone}),
      (_) {},
    );
  }

  /// Creates an account (always WITH a password) for a phone that has none. While the backend has OTP on, `code` (from
  /// [requestRegistrationCode]) is required and proves the caller holds the phone; the backend then creates the account with a
  /// verified phone. For ANY existing account the backend answers with the same generic 401 and changes nothing — registration
  /// never overwrites a password. The app never sends a "verified" flag: only the server decides.
  Future<AuthTokens> passwordRegister(
      {required String phone,
      required String fullName,
      required String password,
      String? code}) {
    return _client.request(
      (dio) => dio.post(
        '/auth/customer/password/register',
        data: {
          'phone': phone,
          'fullName': fullName,
          'password': password,
          if (code != null) 'code': code,
        },
      ),
      (data) => AuthTokens.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Authenticated password CHANGE. The backend requires `currentPassword` (a session alone cannot change a password).
  Future<void> setPassword(
      {required String password, String? currentPassword}) {
    return _client.request(
      (dio) => dio.patch('/auth/customer/password', data: {
        'password': password,
        if (currentPassword != null && currentPassword.isNotEmpty)
          'currentPassword': currentPassword,
      }),
      (_) => null,
    );
  }

  /// Deletes the signed-in customer's own account (store policy). The backend re-checks the password and refuses with
  /// `ACCOUNT_HAS_ACTIVE_ORDERS` / `ACCOUNT_HAS_WALLET_BALANCE` (409) or `PASSWORD_INVALID` (403).
  Future<void> deleteAccount({required String password}) {
    return _client.request(
      (dio) => dio.post('/auth/customer/delete-account', data: {'password': password}),
      (_) {},
    );
  }

  /// Authenticated phone verification — sends a code to the caller's OWN phone. Refused with
  /// `CUSTOMER_OTP_DISABLED` (HTTP 400) while the Admin has OTP switched off.
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

  /// Backs the dismissible post-login phone-verification prompt — the only way the client can know whether the current
  /// session is phone-verified (the JWT payload never carried this) AND whether verifying is possible right now.
  Future<PhoneVerificationStatus> getPhoneVerificationStatus() {
    return _client.request(
      (dio) => dio.get('/auth/customer/me'),
      (data) {
        final json = data['data'] as Map<String, dynamic>;
        return PhoneVerificationStatus(
          isVerified: json['isPhoneVerified'] as bool,
          // An older backend does not send it: verification was then always offered, so keep treating it as available.
          available: json['phoneVerificationAvailable'] as bool? ?? true,
        );
      },
    );
  }

  Future<void> logout() {
    return _client.request((dio) => dio.post('/auth/logout'), (_) => null);
  }
}
