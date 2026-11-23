import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_exception.dart';
import '../data/auth_providers.dart';
import 'session_controller.dart';

/// `enteringPhone` — the sign-in / registration form. `otpSent` — a one-time code was sent; the OTP screen is showing.
enum OtpFlowStep { enteringPhone, otpSent }

class OtpFlowState {
  const OtpFlowState({
    this.step = OtpFlowStep.enteringPhone,
    this.phone,
    this.isSubmitting = false,
    this.errorCode,
    this.resendCooldownSeconds = 0,
  });

  final OtpFlowStep step;
  final String?
      phone; // normalized E.164, set once a verification code has been sent
  final bool isSubmitting;
  final String?
      errorCode; // ApiException.businessCode (falling back to .code) — mapped to text in the UI layer
  final int resendCooldownSeconds;

  OtpFlowState copyWith({
    OtpFlowStep? step,
    String? phone,
    bool? isSubmitting,
    String? errorCode,
    bool clearError = false,
    int? resendCooldownSeconds,
  }) {
    return OtpFlowState(
      step: step ?? this.step,
      phone: phone ?? this.phone,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
      resendCooldownSeconds:
          resendCooldownSeconds ?? this.resendCooldownSeconds,
    );
  }
}

/// Drives customer sign-in and registration. (The class keeps its historical name; it is no longer an OTP-login flow.)
///
/// Approved product rules this controller enforces:
///  - **Sign-in is phone + password, always.** [passwordLogin] never touches an OTP/registration endpoint, whether
///    `CUSTOMER_OTP_ENABLED` is on or off.
///  - **Registration proves the phone BEFORE the account exists (OTP on).** [passwordRegister] first asks the backend to text a
///    code to the phone; the OTP screen then collects it and only that second call ([confirmPhoneVerification]) creates the
///    account — with the password the customer chose and a phone the backend marks verified. Nothing is created until the
///    code is right, so nobody can register a number they do not hold. Leaving the code screen cancels the registration.
///  - **OTP off: no verification step at all.** The backend answers the code request with `CUSTOMER_OTP_DISABLED`; the controller
///    then registers with the password alone and the customer enters the app with an unverified phone (the Home banner offers
///    verification later). The app never marks anything verified itself and never sends a "verified" flag.
///  - **The mode is never cached or assumed.** It is discovered from the backend on every registration (and on every resend), so
///    toggling the Admin setting takes effect immediately and can never leave the app in the wrong flow.
///  - The typed password and name are kept in memory only, for the minutes between asking for the code and typing it; they are
///    never stored in [state], persisted or logged, and are dropped as soon as the flow ends.
///  - The session is only marked authenticated once the account exists and is signed in.
class OtpFlowController extends StateNotifier<OtpFlowState> {
  OtpFlowController(this._ref) : super(const OtpFlowState());

  final Ref _ref;
  Timer? _cooldownTimer;

  /// The registration waiting for its code (in memory only — see the class comment).
  ({String phone, String fullName, String password})? _pendingRegistration;

  static const _resendCooldownSeconds =
      60; // mirrors the backend's OTP_RESEND_COOLDOWN_SECONDS default

  @override
  void dispose() {
    _cooldownTimer?.cancel();
    _pendingRegistration = null;
    super.dispose();
  }

  /// Phone + password sign-in. Never requests an OTP.
  Future<bool> passwordLogin(
      {required String normalizedPhone, required String password}) async {
    if (state.isSubmitting) return false;
    state = state.copyWith(isSubmitting: true, clearError: true);
    try {
      final mustChange = await _ref
          .read(authRepositoryProvider)
          .passwordLoginAndPersistSession(
            phone: normalizedPhone,
            password: password,
          );
      state = state.copyWith(isSubmitting: false);
      _ref
          .read(sessionControllerProvider.notifier)
          .markAuthenticated(mustChangePassword: mustChange == true);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(
          isSubmitting: false, errorCode: e.businessCode ?? e.code);
      return false;
    }
  }

  /// Registration (phone + full name + password): creates the account, always with a password. With OTP on this only STARTS
  /// the registration — it sends the phone a code and moves to the code screen; the account is created by
  /// [confirmPhoneVerification] once the right code is entered. With OTP off it registers immediately. The backend refuses an
  /// existing phone with a generic error and never overwrites a password. Returns false only when it failed outright.
  Future<bool> passwordRegister({
    required String normalizedPhone,
    required String fullName,
    required String password,
  }) async {
    if (state.isSubmitting) return false;
    state = state.copyWith(isSubmitting: true, clearError: true);
    try {
      await _ref
          .read(authRepositoryProvider)
          .requestRegistrationCode(phone: normalizedPhone);
    } on ApiException catch (e) {
      final code = e.businessCode ?? e.code;
      if (code == 'CUSTOMER_OTP_DISABLED') {
        return _completeRegistration(
            phone: normalizedPhone,
            fullName: fullName,
            password: password,
            code: null);
      }
      state = state.copyWith(isSubmitting: false, errorCode: code);
      return false;
    }
    _pendingRegistration =
        (phone: normalizedPhone, fullName: fullName, password: password);
    state = state.copyWith(
      step: OtpFlowStep.otpSent,
      phone: normalizedPhone,
      isSubmitting: false,
      resendCooldownSeconds: _resendCooldownSeconds,
    );
    _startCooldown();
    return true;
  }

  /// Creates the account (with [code] when OTP is on) and signs the new customer in.
  Future<bool> _completeRegistration({
    required String phone,
    required String fullName,
    required String password,
    required String? code,
  }) async {
    try {
      await _ref.read(authRepositoryProvider).passwordRegisterAndPersistSession(
            phone: phone,
            fullName: fullName,
            password: password,
            code: code,
          );
    } on ApiException catch (e) {
      state = state.copyWith(
          isSubmitting: false, errorCode: e.businessCode ?? e.code);
      return false;
    }
    _cooldownTimer?.cancel();
    _pendingRegistration = null;
    state = state.copyWith(isSubmitting: false);
    _ref.read(sessionControllerProvider.notifier).markAuthenticated();
    return true;
  }

  /// Submits the code the customer typed together with the pending registration: the backend verifies it and only then
  /// creates the account (phone verified) and returns the session. A wrong or expired code keeps the customer on the code
  /// screen with an error; nothing exists yet.
  Future<bool> confirmPhoneVerification(String code) async {
    final pending = _pendingRegistration;
    if (state.phone == null || state.isSubmitting) return false;
    if (pending == null) {
      _resetToForm(); // nothing to complete (e.g. the app was restarted mid-flow): back to the form
      return false;
    }
    state = state.copyWith(isSubmitting: true, clearError: true);
    return _completeRegistration(
        phone: pending.phone,
        fullName: pending.fullName,
        password: pending.password,
        code: code);
  }

  /// Sends a new code to the phone being registered. If the Admin switched OTP off in the meantime there is nothing left to
  /// prove: the registration simply completes without a code (the phone stays unverified).
  Future<void> resendVerification() async {
    final pending = _pendingRegistration;
    if (state.resendCooldownSeconds > 0 ||
        state.phone == null ||
        pending == null ||
        state.isSubmitting) {
      return;
    }
    state = state.copyWith(isSubmitting: true, clearError: true);
    try {
      await _ref
          .read(authRepositoryProvider)
          .requestRegistrationCode(phone: pending.phone);
      state = state.copyWith(
          isSubmitting: false, resendCooldownSeconds: _resendCooldownSeconds);
      _startCooldown();
    } on ApiException catch (e) {
      final code = e.businessCode ?? e.code;
      if (code == 'CUSTOMER_OTP_DISABLED') {
        await _completeRegistration(
            phone: pending.phone,
            fullName: pending.fullName,
            password: pending.password,
            code: null);
        return;
      }
      state = state.copyWith(isSubmitting: false, errorCode: code);
    }
  }

  /// Leaves the code screen ("change phone number" / back): the registration is cancelled — no account was created — and the
  /// form is shown again; the typed password is forgotten.
  void skipVerification() => _resetToForm();

  void _resetToForm() {
    _cooldownTimer?.cancel();
    _pendingRegistration = null;
    state = const OtpFlowState();
  }

  void clearError() {
    state = state.copyWith(clearError: true);
  }

  void _startCooldown() {
    _cooldownTimer?.cancel();
    _cooldownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      final remaining = state.resendCooldownSeconds - 1;
      if (remaining <= 0) {
        timer.cancel();
        state = state.copyWith(resendCooldownSeconds: 0);
      } else {
        state = state.copyWith(resendCooldownSeconds: remaining);
      }
    });
  }
}

final otpFlowControllerProvider =
    StateNotifierProvider.autoDispose<OtpFlowController, OtpFlowState>(
  (ref) => OtpFlowController(ref),
);
