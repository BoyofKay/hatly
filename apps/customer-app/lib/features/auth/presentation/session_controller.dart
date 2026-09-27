import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../data/auth_providers.dart';

enum SessionStatus {
  /// Initial state while we check secure storage for a persisted
  /// session — the router shows the splash screen during this.
  checking,
  authenticated,
  unauthenticated,
}

class SessionState {
  const SessionState(this.status);
  final SessionStatus status;
}

/// The single source of truth for "is this user logged in", read by
/// the router to decide where to send them. Nothing else in the app
/// should independently track auth status.
class SessionController extends StateNotifier<SessionState> {
  SessionController(this._ref)
      : super(const SessionState(SessionStatus.checking)) {
    _restore();
  }

  final Ref _ref;

  Future<void> _restore() async {
    final hasSession =
        await _ref.read(authRepositoryProvider).hasPersistedSession();
    state = SessionState(hasSession
        ? SessionStatus.authenticated
        : SessionStatus.unauthenticated);
    if (hasSession) {
      _initializePushNotifications();
    }
  }

  void markAuthenticated() {
    state = const SessionState(SessionStatus.authenticated);
    _initializePushNotifications();
  }

  /// Customer Push Notifications (Chunk B). Fires after BOTH a fresh
  /// login (markAuthenticated()) AND a restored session (_restore
  /// finding an existing session) — mirroring the Driver app's own
  /// `AuthStateNotifier._initializePushNotifications` exactly (same
  /// "covers both, not just a brand-new login" reasoning). Uses the
  /// single shared `fcmServiceProvider` instance — this only ever
  /// calls `.initialize()` on it, which is itself idempotent (see
  /// FcmService's own `_initialized` guard), so calling this on every
  /// authenticated transition within one app process never
  /// re-registers listeners twice. Failures are swallowed —
  /// best-effort, non-blocking; a Customer without push registered
  /// simply doesn't receive one, and this must never block or fail
  /// the login/session-restore flow itself.
  Future<void> _initializePushNotifications() async {
    try {
      await _ref.read(fcmServiceProvider).initialize();
    } catch (_) {
      // Firebase not configured for this build/environment, or
      // platform permission denied — never block auth on this.
    }
  }

  /// Called after a real logout action (see AuthRepository.logout).
  Future<void> logout() async {
    await _ref.read(authRepositoryProvider).logout();
    state = const SessionState(SessionStatus.unauthenticated);
  }

  /// Called by ApiClient when a refresh ultimately fails — the
  /// backend has already invalidated the session server-side (or it
  /// was never valid), so this only needs to clear local state, not
  /// call /auth/logout again.
  Future<void> forceLogout() async {
    await _ref.read(tokenStorageProvider).clear();
    state = const SessionState(SessionStatus.unauthenticated);
  }
}

final sessionControllerProvider =
    StateNotifierProvider<SessionController, SessionState>(
  (ref) => SessionController(ref),
);
