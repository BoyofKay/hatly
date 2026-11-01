import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/core/network/providers.dart';
import 'package:hatly_customer/core/push/fcm_service.dart';
import 'package:hatly_customer/core/storage/token_storage.dart';
import 'package:hatly_customer/features/auth/data/auth_api.dart';
import 'package:hatly_customer/features/auth/data/auth_providers.dart';

/// In-memory stand-in for the Keychain-backed token storage (never touches the platform channel).
class FakeAuthTokenStorage extends TokenStorage {
  String? access;
  String? refresh;
  String? name;

  @override
  Future<String?> get accessToken async => access;
  @override
  Future<String?> get refreshToken async => refresh;
  @override
  Future<String?> get displayName async => name;
  @override
  Future<void> saveTokens(
      {required String accessToken, required String refreshToken}) async {
    access = accessToken;
    refresh = refreshToken;
  }

  @override
  Future<void> saveDisplayName(String? displayName) async {
    if (displayName != null && displayName.isNotEmpty) name = displayName;
  }

  @override
  Future<void> clear() async {
    access = null;
    refresh = null;
    name = null;
  }
}

ApiException apiError(String code, {String? businessCode, int? status}) =>
    ApiException(
      code: code,
      message: 'backend text — never shown',
      details: businessCode == null ? null : {'code': businessCode},
      statusCode: status,
    );

/// The backend's answer while the Admin has `CUSTOMER_OTP_ENABLED` switched off.
ApiException get otpDisabledError =>
    apiError('BAD_REQUEST', businessCode: 'CUSTOMER_OTP_DISABLED', status: 400);

/// A scriptable backend: every call is recorded in [calls] (the endpoint-level contract), and each outcome can be set.
class FakeAuthApi implements AuthApi {
  /// Whether `CUSTOMER_OTP_ENABLED` is currently on. Changing it between calls simulates the Admin toggling it mid-flow.
  bool otpEnabled = true;

  /// Whether the account's phone is already verified (e.g. an account verified earlier).
  bool phoneVerified = false;

  ApiException? loginError;
  ApiException? registerError;
  ApiException? registrationCodeError;

  /// The one code the scripted backend accepts at registration while OTP is on.
  static const acceptedCode = '123456';

  /// Accounts the scripted backend actually created (each with a password).
  final registeredAccounts =
      <({String phone, String fullName, bool passwordGiven})>[];
  ApiException? requestVerificationError;
  ApiException? confirmError;
  final calls = <String>[];

  /// Passwords sent to `deleteAccount`, and the refusal (if any) the scripted backend answers with.
  final deleteAccountCalls = <String>[];
  ApiException? deleteAccountError;

  static const tokens =
      AuthTokens(accessToken: 'access-token', refreshToken: 'refresh-token');

  @override
  Future<void> deleteAccount({required String password}) async {
    calls.add('deleteAccount');
    deleteAccountCalls.add(password);
    if (deleteAccountError != null) throw deleteAccountError!;
  }

  @override
  Future<AuthTokens> passwordLogin(
      {required String phone, required String password}) async {
    calls.add('passwordLogin');
    if (loginError != null) throw loginError!;
    return tokens;
  }

  @override
  Future<void> requestRegistrationCode({required String phone}) async {
    calls.add('requestRegistrationCode');
    if (registrationCodeError != null) throw registrationCodeError!;
    if (!otpEnabled) throw otpDisabledError;
  }

  /// What the backend would do: with OTP on it demands the right code BEFORE creating anything and then creates the account
  /// with a VERIFIED phone (its own decision); with OTP off it needs no code and the phone stays unverified.
  @override
  Future<AuthTokens> passwordRegister(
      {required String phone,
      required String fullName,
      required String password,
      String? code}) async {
    calls.add(code == null ? 'passwordRegister' : 'passwordRegister:$code');
    if (registerError != null) throw registerError!;
    if (otpEnabled) {
      if (code == null) {
        throw apiError('BAD_REQUEST',
            businessCode: 'PHONE_VERIFICATION_REQUIRED', status: 400);
      }
      if (code != acceptedCode) throw apiError('UNAUTHORIZED', status: 401);
    }
    registeredAccounts.add(
        (phone: phone, fullName: fullName, passwordGiven: password.isNotEmpty));
    phoneVerified = otpEnabled;
    return tokens;
  }

  @override
  Future<void> requestPhoneVerification() async {
    calls.add('requestPhoneVerification');
    if (requestVerificationError != null) throw requestVerificationError!;
    if (!otpEnabled) throw otpDisabledError;
  }

  @override
  Future<void> confirmPhoneVerification({required String code}) async {
    calls.add('confirmPhoneVerification:$code');
    if (confirmError != null) throw confirmError!;
    phoneVerified = true;
  }

  @override
  Future<PhoneVerificationStatus> getPhoneVerificationStatus() async {
    calls.add('getPhoneVerificationStatus');
    // What the backend answers: the phone's real state, and whether verifying is possible NOW (the OTP setting).
    return PhoneVerificationStatus(
        isVerified: phoneVerified, available: otpEnabled);
  }

  ApiException? setPasswordError;
  final setPasswordCalls = <Map<String, String?>>[];

  @override
  Future<void> setPassword(
      {required String password, String? currentPassword}) async {
    calls.add('setPassword');
    setPasswordCalls
        .add({'password': password, 'currentPassword': currentPassword});
    if (setPasswordError != null) throw setPasswordError!;
  }

  @override
  Future<void> logout() async => calls.add('logout');
}

/// A push service that never touches Firebase, so a test that signs in does not try to initialise it.
FcmService _noopFcm() =>
    FcmService(onTokenReceived: (_) {}, onTokenRefreshed: (_) {});

/// Overrides that put the real repository, flow controller and session controller on top of a scripted backend.
List<Override> authOverrides(FakeAuthApi api, FakeAuthTokenStorage storage) => [
      authApiProvider.overrideWithValue(api),
      tokenStorageProvider.overrideWithValue(storage),
      fcmServiceProvider.overrideWith((ref) => _noopFcm()),
    ];
