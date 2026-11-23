import 'package:dio/dio.dart';
import 'api_exception.dart';
import '../storage/token_storage.dart';

/// Central HTTP client for the customer app.
///
/// Responsibilities:
///  - attaches the access token to every request
///  - on a 401, refreshes the session ONCE and retries the original
///    request — callers never see token logic
///  - de-duplicates concurrent refreshes: if five requests all get a
///    401 at once, only one `/auth/refresh` call is made and the
///    other four wait on it, rather than each firing its own refresh.
///    This matters specifically because the backend rotates refresh
///    tokens (single-use) — firing several refresh calls concurrently
///    with the same stored refresh token would have the second one
///    fail outright, since the first already consumed it.
///  - never retries more than once per request (guards against an
///    infinite refresh loop if the backend keeps returning 401 even
///    after a "successful" refresh).
///  - calls [onSessionExpired] exactly when the app should treat the
///    user as logged out (refresh itself failed) — wired to the
///    session controller so routing reacts without every call site
///    needing to know about auth.
class ApiClient {
  ApiClient(
      {required this.baseUrl,
      required this.tokenStorage,
      this.onSessionExpired,
      this.onPasswordChangeRequired}) {
    _dio = Dio(BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 10),
        // Dio's receive timeout is IDLE time between pieces of the response, not the total duration. Without one, a connection that
        // opens and then stalls (a slow or filtered route from abroad, a half-dead mobile link) leaves a screen on its loading
        // spinner forever with no error and no retry; with it the failure surfaces as the normal NETWORK_ERROR + "Retry".
        receiveTimeout: const Duration(seconds: 30)));

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await tokenStorage.accessToken;
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final alreadyRetried =
              error.requestOptions.extra['retriedAfterRefresh'] == true;
          final isAuthEndpoint = error.requestOptions.path.startsWith('/auth/');

          // Signed in with a temporary password set by Hatly (owner decision 2026-11-23): the server refuses everything except
          // the password change until the customer chooses a new one — send them to that screen.
          final body = error.response?.data;
          if (error.response?.statusCode == 403 &&
              body is Map &&
              body['error'] is Map &&
              ((body['error'] as Map)['details'] as Map?)?['code'] ==
                  'PASSWORD_CHANGE_REQUIRED') {
            onPasswordChangeRequired?.call();
          }

          if (error.response?.statusCode == 401 &&
              !alreadyRetried &&
              !isAuthEndpoint) {
            final refreshed = await _refreshOnce();
            if (refreshed) {
              try {
                final retryOptions = error.requestOptions
                  ..extra['retriedAfterRefresh'] = true;
                final retryResponse = await _dio.fetch(retryOptions);
                return handler.resolve(retryResponse);
              } catch (_) {
                // fall through to onSessionExpired below
              }
            }
            await _notifySessionExpiredOnce();
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

  // Ensures at most one /auth/refresh call is in flight at a time;
  // concurrent callers await the same Future instead of each starting
  // their own refresh.
  Future<bool>? _inFlightRefresh;

  Future<bool> _refreshOnce() {
    return _inFlightRefresh ??= _performRefresh().whenComplete(() {
      _inFlightRefresh = null;
    });
  }

  // Reliability & Adversarial Testing milestone fix (client-level): several requests can hit a 401
  // at once, and every one of them independently reaches this point when the shared refresh above
  // ultimately failed (or a fresh-token retry still failed) — WITHOUT this de-dup, each one would
  // separately call `tokenStorage.clear()`/`onSessionExpired()`, i.e. the same "you've been logged
  // out" side effect firing once per concurrent request instead of once per actual session-expiry
  // event (reproduced deterministically: 5 concurrent 401s → 5 clear()/onSessionExpired() calls).
  // Same in-flight-Future de-dup pattern as `_refreshOnce` above, and for the same reason: it merges
  // only genuinely CONCURRENT callers — once this completes and the field resets, a later, truly
  // separate session-expiry event (e.g. after a fresh login) still notifies normally.
  Future<void>? _inFlightSessionExpiry;

  Future<void> _notifySessionExpiredOnce() {
    return _inFlightSessionExpiry ??= (() async {
      await tokenStorage.clear();
      onSessionExpired?.call();
    })()
        .whenComplete(() => _inFlightSessionExpiry = null);
  }

  Future<bool> _performRefresh() async {
    final refreshToken = await tokenStorage.refreshToken;
    if (refreshToken == null) return false;

    try {
      final response = await _dio
          .post('/auth/refresh', data: {'refreshToken': refreshToken});
      final data = response.data['data'];
      await tokenStorage.saveTokens(
        accessToken: data['accessToken'],
        refreshToken: data['refreshToken'],
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Wraps a raw Dio call and converts any failure into [ApiException],
  /// so repositories never need to know about Dio/DioException directly.
  Future<T> request<T>(
    Future<Response> Function(Dio dio) call,
    T Function(dynamic data) parse,
  ) async {
    try {
      final response = await call(_dio);
      return parse(response.data);
    } on DioException catch (e) {
      throw ApiException.fromDioError(e);
    }
  }
}
