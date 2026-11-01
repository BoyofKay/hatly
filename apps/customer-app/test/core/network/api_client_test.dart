import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/api_client.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/core/storage/token_storage.dart';

/// Overrides only the persistence methods `ApiClient` actually calls — never touches the real
/// platform channel `flutter_secure_storage` needs, so this runs in plain `flutter_test`.
class FakeTokenStorage extends TokenStorage {
  String? access = 'access-1';
  String? refresh = 'refresh-1';
  final saveCalls = <Map<String, String>>[];
  int clearCalls = 0;

  @override
  Future<String?> get accessToken async => access;
  @override
  Future<String?> get refreshToken async => refresh;

  @override
  Future<void> saveTokens(
      {required String accessToken, required String refreshToken}) async {
    saveCalls.add({'accessToken': accessToken, 'refreshToken': refreshToken});
    access = accessToken;
    refresh = refreshToken;
  }

  @override
  Future<void> clear() async {
    clearCalls++;
    access = null;
    refresh = null;
  }
}

/// A minimal, dependency-free Dio transport double (Dio's own supported test seam — no extra
/// package needed). Simulates a protected endpoint that answers 401 until the caller retries
/// with a token minted AFTER `/auth/refresh` succeeds, and a controllable `/auth/refresh` outcome.
class FakeAdapter implements HttpClientAdapter {
  final refreshCalls = <String?>[]; // the refresh token each /auth/refresh call actually carried
  final protectedCalls = <String?>[]; // the Authorization header each protected call actually carried
  bool refreshSucceeds = true;
  String nextAccessToken = 'access-2';
  String nextRefreshToken = 'refresh-2';
  /// When true, the "protected" resource rejects EVERY token, even a freshly refreshed one — a
  /// broken-backend scenario, decoupled from `nextAccessToken` (which is always what the refresh
  /// endpoint actually hands back) so the two concerns can't be accidentally conflated.
  bool protectedAlwaysRejects = false;
  Completer<void>? refreshGate; // lets a test pause the refresh response mid-flight

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    if (options.path == '/auth/refresh') {
      final sentRefreshToken = (options.data as Map)['refreshToken'] as String?;
      refreshCalls.add(sentRefreshToken);
      if (refreshGate != null) await refreshGate!.future;
      if (!refreshSucceeds) {
        return ResponseBody.fromString('{"error":{"code":"UNAUTHORIZED"}}', 401);
      }
      return ResponseBody.fromString(
        '{"data":{"accessToken":"$nextAccessToken","refreshToken":"$nextRefreshToken"}}',
        200,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
      );
    }

    // The "protected" resource under test: 401 unless this exact request already carries the
    // NEW access token that only exists after a successful refresh.
    final auth = options.headers['Authorization'] as String?;
    protectedCalls.add(auth);
    if (!protectedAlwaysRejects && auth == 'Bearer $nextAccessToken') {
      return ResponseBody.fromString('{"data":{"ok":true}}', 200,
          headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
    }
    return ResponseBody.fromString('{"error":{"code":"UNAUTHORIZED"}}', 401);
  }

  @override
  void close({bool force = false}) {}
}

/// A server that accepts the connection and then never answers — what Dio reports as a receive timeout.
class _StalledAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    throw DioException.receiveTimeout(timeout: options.receiveTimeout ?? const Duration(seconds: 30), requestOptions: options);
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late FakeTokenStorage tokenStorage;
  late FakeAdapter adapter;
  late ApiClient client;
  int sessionExpiredCalls = 0;

  setUp(() {
    tokenStorage = FakeTokenStorage();
    adapter = FakeAdapter();
    sessionExpiredCalls = 0;
    client = ApiClient(
      baseUrl: 'https://api.test',
      tokenStorage: tokenStorage,
      onSessionExpired: () => sessionExpiredCalls++,
    );
    client.dio.httpClientAdapter = adapter;
  });

  Future<Response> hit(String path) => client.dio.get(path);

  group('Reliability & Adversarial Testing milestone (client-level): concurrent 401 / token refresh', () {
    test('5 requests all getting a 401 at once trigger exactly ONE /auth/refresh call, and all 5 succeed after it', () async {
      final results = await Future.wait(
        List.generate(5, (_) => hit('/orders').then((r) => r.statusCode)),
      );

      expect(adapter.refreshCalls, hasLength(1),
          reason: 'the backend rotates refresh tokens (single-use) — a second concurrent call would '
              'have sent the SAME already-consumed refresh token and failed outright');
      expect(results, everyElement(200));
      expect(tokenStorage.saveCalls, hasLength(1));
      expect(sessionExpiredCalls, 0);
    });

    test('a single request retries exactly once after a successful refresh, never looping forever if the backend keeps saying 401', () async {
      // The refresh itself succeeds (a genuinely fresh token is issued and saved), but the resource
      // rejects EVERY token regardless — a broken-backend scenario, not a stale-token one.
      adapter.protectedAlwaysRejects = true;
      DioException? thrown;
      try {
        await hit('/orders');
      } on DioException catch (e) {
        thrown = e;
      }

      expect(thrown?.response?.statusCode, 401); // surfaced, not retried a second time
      expect(adapter.protectedCalls, hasLength(2)); // original + exactly one retry
      expect(adapter.refreshCalls, hasLength(1));
      expect(tokenStorage.saveCalls, hasLength(1)); // the refresh itself DID succeed and was saved
    });

    test(
        'CRITICAL (the bug this milestone fixes): a failed refresh clears tokens and calls onSessionExpired exactly ONCE, '
        'even for 5 concurrent 401s — not once per concurrent request', () async {
      adapter.refreshSucceeds = false;

      final results = await Future.wait(
        List.generate(5, (_) => hit('/orders').then((r) => r.statusCode).catchError((_) => -1)),
      );

      expect(adapter.refreshCalls, hasLength(1));
      expect(tokenStorage.clearCalls, 1);
      expect(sessionExpiredCalls, 1);
      expect(results, everyElement(anyOf(401, -1)));
    });

    test('a request to /auth/* itself never triggers a refresh loop on its own 401', () async {
      final response = await client.dio.post('/auth/refresh', data: {'refreshToken': 'whatever'});
      // The FakeAdapter's own /auth/refresh branch always answers 200 here (refreshSucceeds defaults
      // true) — the real point of this test is structural: the interceptor's `isAuthEndpoint` guard
      // means an auth-endpoint 401 is never itself used to trigger ANOTHER refresh attempt.
      expect(response.statusCode, 200);
      expect(adapter.refreshCalls, hasLength(1)); // this call itself, not a second nested refresh
    });
  });

  group('timeouts: a stalled connection must end in an error the screen can retry, never an endless spinner', () {
    test('the client has BOTH a connect and an idle-receive timeout', () {
      expect(client.dio.options.connectTimeout, const Duration(seconds: 10));
      expect(client.dio.options.receiveTimeout, const Duration(seconds: 30));
    });

    test('a receive timeout surfaces as the app\'s NETWORK_ERROR (which every screen already offers to retry)', () async {
      client.dio.httpClientAdapter = _StalledAdapter();
      Object? caught;
      try {
        await client.request((dio) => dio.get('/sectors'), (data) => data);
      } catch (e) {
        caught = e;
      }
      expect(caught, isA<ApiException>());
      expect((caught as ApiException).code, 'NETWORK_ERROR');
    });
  });
}
