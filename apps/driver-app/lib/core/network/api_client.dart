import 'package:dio/dio.dart';
import '../storage/token_storage.dart';

/// Central HTTP client for the customer app. Attaches the access token
/// to every request and transparently retries once after a refresh on
/// a 401 — callers never handle token logic themselves.
///
/// M4 — Session / device safety. `onSessionExpired` fires exactly once per
/// irrecoverable 401 (no refresh token stored, or the refresh call itself
/// fails) — i.e. the same moment `tokenStorage.clear()` already ran. This is
/// what lets the app react to a session becoming invalid from ANY API call,
/// not only the driver's own explicit logout button — see
/// `core/network/providers.dart`'s wiring for what it actually does
/// (flip `authStateProvider` to unauthenticated + stop the GPS timer),
/// which in turn lets the router's existing auth guard redirect to
/// `/login`, so a stale/unauthorized session can never leave the driver
/// looking at assignment/status data that isn't really theirs anymore.
class ApiClient {
  ApiClient({required this.baseUrl, required this.tokenStorage, this.onSessionExpired, this.onPasswordChangeRequired}) {
    _dio = Dio(BaseOptions(baseUrl: baseUrl, connectTimeout: const Duration(seconds: 10)));

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await tokenStorage.accessToken;
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          // R16: this build has the "I've seen this order" button, so opening an order must not count as acknowledging it.
          options.headers['X-Hatly-Driver-Ack'] = 'explicit';
          handler.next(options);
        },
        onError: (error, handler) async {
          // Signed in with a temporary password (owner decision 2026-11-23): the server refuses everything but the password change.
          final body = error.response?.data;
          if (error.response?.statusCode == 403 &&
              body is Map &&
              body['error'] is Map &&
              ((body['error'] as Map)['details'] as Map?)?['code'] == 'PASSWORD_CHANGE_REQUIRED') {
            onPasswordChangeRequired?.call();
          }
          // M4 fix: a 401 FROM `/auth/refresh` itself (an invalid/expired
          // refresh token) must never re-enter `_tryRefresh()` — that call
          // goes through this SAME `_dio`/interceptor, so without this guard
          // a bad refresh token caused unbounded recursive refresh attempts
          // (a real, pre-existing hang, not merely a theoretical one —
          // caught by this milestone's own session-expiry test).
          if (error.response?.statusCode == 401 && error.requestOptions.path != '/auth/refresh') {
            final refreshed = await _refreshOnce();
            if (refreshed) {
              final retryResponse = await _dio.fetch(error.requestOptions);
              return handler.resolve(retryResponse);
            }
          }
          handler.next(error);
        },
      ),
    );
  }

  final String baseUrl;
  final TokenStorage tokenStorage;
  final void Function()? onSessionExpired;

  /// Called when the server answers PASSWORD_CHANGE_REQUIRED (temporary password still in force).
  final void Function()? onPasswordChangeRequired;
  late final Dio _dio;

  Dio get dio => _dio;

  // Single-use refresh tokens with reuse detection on the backend (AuthService.refresh → RefreshTokenStore.rotate): presenting
  // an already-rotated refresh token revokes EVERY session of the user. The GPS ping, the deliveries poll and screen refreshes run
  // concurrently, so several 401s arrive together after the access token expires — each must await the SAME refresh, never start
  // its own with the same token (that second refresh logged the driver out). Same in-flight-Future pattern as the customer app.
  Future<bool>? _inFlightRefresh;

  Future<bool> _refreshOnce() {
    return _inFlightRefresh ??= _tryRefresh().whenComplete(() => _inFlightRefresh = null);
  }

  // Concurrent callers of a failed shared refresh are told about the expiry once, not once per request.
  Future<void>? _inFlightSessionExpiry;

  Future<void> _notifySessionExpiredOnce() {
    return _inFlightSessionExpiry ??= (() async {
      await tokenStorage.clear();
      onSessionExpired?.call();
    })().whenComplete(() => _inFlightSessionExpiry = null);
  }

  Future<bool> _tryRefresh() async {
    final refreshToken = await tokenStorage.refreshToken;
    if (refreshToken == null) {
      await _notifySessionExpiredOnce();
      return false;
    }
    try {
      final response = await _dio.post(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      final data = response.data['data'];
      await tokenStorage.saveTokens(
        accessToken: data['accessToken'],
        refreshToken: data['refreshToken'],
      );
      return true;
    } catch (_) {
      await _notifySessionExpiredOnce();
      return false;
    }
  }
}
