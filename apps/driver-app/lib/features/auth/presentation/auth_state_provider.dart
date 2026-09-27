import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';

class AuthState {
  const AuthState({required this.isAuthenticated});
  final bool isAuthenticated;
}

class AuthStateNotifier extends StateNotifier<AuthState> {
  AuthStateNotifier(this._ref) : super(const AuthState(isAuthenticated: false)) {
    _restore();
  }

  final Ref _ref;

  Future<void> _restore() async {
    final token = await _ref.read(tokenStorageProvider).accessToken;
    final isAuthenticated = token != null;
    state = AuthState(isAuthenticated: isAuthenticated);
    if (isAuthenticated) {
      _initializePushNotifications();
    }
  }

  void setAuthenticated(bool value) {
    state = AuthState(isAuthenticated: value);
    if (value) {
      _initializePushNotifications();
    }
  }

  /// Driver Push Notifications (Section 5). Fires after BOTH a fresh
  /// login (setAuthenticated(true)) AND a restored session (_restore
  /// finding an existing token) — CONFIRMED: "after successful Driver
  /// login/session initialization" covers both, not just a brand-new
  /// login. Uses the SINGLE shared `fcmServiceProvider` instance (see
  /// its own comment for why this must never be constructed more than
  /// once) — this only ever calls `.initialize()` on it, which is
  /// itself idempotent. Failures are swallowed — best-effort,
  /// non-blocking; a Driver without push registered simply keeps
  /// relying on the existing polling fallback, and this must never
  /// block or fail the login/session-restore flow itself.
  Future<void> _initializePushNotifications() async {
    try {
      await _ref.read(fcmServiceProvider).initialize();
    } catch (_) {
      // Firebase not configured for this build/environment, or
      // platform permission denied — never block auth on this.
    }
  }

  /// CONFIRMED (approved logout behavior): clears the stored session —
  /// without this, `_restore()` would find a stale token still present
  /// on next launch and incorrectly treat the driver as still logged
  /// in. GPS/online-state cleanup happens separately, at the call site
  /// (see `DriverOnlineStateNotifier.resetOnLogout()`), since this
  /// notifier has no knowledge of location/online state.
  Future<void> logout() async {
    await _ref.read(tokenStorageProvider).clear();
    state = const AuthState(isAuthenticated: false);
  }
}

final authStateProvider = StateNotifierProvider<AuthStateNotifier, AuthState>(
  (ref) => AuthStateNotifier(ref),
);
