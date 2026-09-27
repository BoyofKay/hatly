import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_exception.dart';
import '../data/auth_providers.dart';
import 'session_controller.dart';

enum OtpFlowStep { enteringPhone, otpSent }

/// Customer Authentication Modes (master implementation). Which
/// credential the phone-entry/next screens currently expect —
/// discovered from the backend's own `CUSTOMER_OTP_DISABLED` response
/// (attempt-and-react, per the approved design; no separate "discover
/// mode" network call), never decided client-side.
enum AuthMode { otp, password }

class OtpFlowState {
  const OtpFlowState({
    this.step = OtpFlowStep.enteringPhone,
    this.mode = AuthMode.otp,
    this.phone,
    this.fullName,
    this.isSubmitting = false,
    this.errorCode,
    this.resendCooldownSeconds = 0,
  });

  final OtpFlowStep step;
  final AuthMode mode;
  final String? phone; // normalized E.164, set once OTP has been requested
  final String?
      fullName; // remembered so resendOtp() doesn't need it re-passed from the OTP screen
  final bool isSubmitting;
  final String?
      errorCode; // ApiException.businessCode (falling back to .code) — mapped to text in the UI layer
  final int resendCooldownSeconds;

  OtpFlowState copyWith({
    OtpFlowStep? step,
    AuthMode? mode,
    String? phone,
    String? fullName,
    bool? isSubmitting,
    String? errorCode,
    bool clearError = false,
    int? resendCooldownSeconds,
  }) {
    return OtpFlowState(
      step: step ?? this.step,
      mode: mode ?? this.mode,
      phone: phone ?? this.phone,
      fullName: fullName ?? this.fullName,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      errorCode: clearError ? null : (errorCode ?? this.errorCode),
      resendCooldownSeconds:
          resendCooldownSeconds ?? this.resendCooldownSeconds,
    );
  }
}

/// Drives the phone -> OTP flow AND (Customer Authentication Modes)
/// the phone+password fallback — kept as ONE controller, per the
/// approved design's explicit "do not create a separate authentication
/// system"; [AuthMode] is just a field on the same state, not a
/// parallel state machine. Deliberately does not distinguish "new" vs
/// "returning" customer at the UI level for either mode — see
/// AuthApi's doc comments for why a single call correctly covers both
/// without leaking which case it was.
class OtpFlowController extends StateNotifier<OtpFlowState> {
  OtpFlowController(this._ref) : super(const OtpFlowState());

  final Ref _ref;
  Timer? _cooldownTimer;

  static const _resendCooldownSeconds =
      60; // mirrors the backend's OTP_RESEND_COOLDOWN_SECONDS default

  @override
  void dispose() {
    _cooldownTimer?.cancel();
    super.dispose();
  }

  Future<void> requestOtp(
      {required String normalizedPhone, required String fullName}) async {
    state = state.copyWith(isSubmitting: true, clearError: true);
    try {
      await _ref
          .read(authRepositoryProvider)
          .requestOtp(phone: normalizedPhone, fullName: fullName);
      state = state.copyWith(
        step: OtpFlowStep.otpSent,
        phone: normalizedPhone,
        fullName: fullName,
        isSubmitting: false,
        resendCooldownSeconds: _resendCooldownSeconds,
      );
      _startCooldown();
    } on ApiException catch (e) {
      if (e.businessCode == 'CUSTOMER_OTP_DISABLED') {
        // Not a failure the user needs to see as an error — the app
        // simply switches to the password fields on the same screen.
        // Backend remains authoritative: this is discovered from its
        // response, never assumed or cached client-side.
        state = state.copyWith(
            mode: AuthMode.password, isSubmitting: false, clearError: true);
        return;
      }
      state = state.copyWith(
          isSubmitting: false, errorCode: e.businessCode ?? e.code);
    }
  }

  /// Re-sends to the phone number already captured on the previous
  /// screen, reusing the full name captured there too — the OTP
  /// screen itself never needs to know or re-collect it.
  Future<void> resendOtp() async {
    if (state.resendCooldownSeconds > 0 || state.phone == null) return;
    await requestOtp(
        normalizedPhone: state.phone!, fullName: state.fullName ?? '');
  }

  Future<bool> verifyOtp(String code) async {
    if (state.phone == null) return false;
    state = state.copyWith(isSubmitting: true, clearError: true);
    try {
      await _ref.read(authRepositoryProvider).verifyOtpAndPersistSession(
          phone: state.phone!, code: code, fullName: state.fullName);
      _ref.read(sessionControllerProvider.notifier).markAuthenticated();
      state = state.copyWith(isSubmitting: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(
          isSubmitting: false, errorCode: e.businessCode ?? e.code);
      return false;
    }
  }

  /// MODE B — phone+password login. Same isSubmitting/errorCode
  /// handling and same `markAuthenticated()` finish as the OTP path.
  Future<bool> passwordLogin(
      {required String normalizedPhone, required String password}) async {
    state = state.copyWith(isSubmitting: true, clearError: true);
    try {
      await _ref.read(authRepositoryProvider).passwordLoginAndPersistSession(
            phone: normalizedPhone,
            password: password,
          );
      _ref.read(sessionControllerProvider.notifier).markAuthenticated();
      state = state.copyWith(isSubmitting: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(
          isSubmitting: false, errorCode: e.businessCode ?? e.code);
      return false;
    }
  }

  /// MODE B — phone+fullName+password registration/attachment (the
  /// backend alone decides which of the two cases applies — see
  /// AuthApi.passwordRegister's own comment).
  Future<bool> passwordRegister({
    required String normalizedPhone,
    required String fullName,
    required String password,
  }) async {
    state = state.copyWith(isSubmitting: true, clearError: true);
    try {
      await _ref.read(authRepositoryProvider).passwordRegisterAndPersistSession(
            phone: normalizedPhone,
            fullName: fullName,
            password: password,
          );
      _ref.read(sessionControllerProvider.notifier).markAuthenticated();
      state = state.copyWith(isSubmitting: false);
      return true;
    } on ApiException catch (e) {
      state = state.copyWith(
          isSubmitting: false, errorCode: e.businessCode ?? e.code);
      return false;
    }
  }

  void changePhoneNumber() {
    _cooldownTimer?.cancel();
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
