import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/core/network/api_client.dart';
import 'package:hatly_driver/core/storage/token_storage.dart';

/// M4 — Session / device safety. `TokenStorage` wraps `flutter_secure_storage`,
/// which has no platform channel in plain Dart unit tests — every method is
/// overridden with a real in-memory implementation instead (constructing the
/// real `TokenStorage` itself is harmless; only its read/write/delete methods
/// touch the platform channel, and none of those are ever called here).
class FakeTokenStorage implements TokenStorage {
  String? _access;
  String? _refresh;
  bool cleared = false;

  void seed({String? access, String? refresh}) {
    _access = access;
    _refresh = refresh;
  }

  @override
  Future<String?> get accessToken async => _access;

  @override
  Future<String?> get refreshToken async => _refresh;

  @override
  Future<void> saveTokens({required String accessToken, required String refreshToken}) async {
    _access = accessToken;
    _refresh = refreshToken;
  }

  @override
  Future<void> clear() async {
    cleared = true;
    _access = null;
    _refresh = null;
  }
}

/// A minimal fake Dio transport — real HTTP requires network/platform I/O
/// this test environment doesn't have, and Dio's own adapter interface is
/// the documented seam for exactly this kind of test.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.handler);

  final ResponseBody Function(RequestOptions options, int callNumberForThisPath) handler;
  final Map<String, int> _callCounts = {};

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final n = (_callCounts[options.path] ?? 0) + 1;
    _callCounts[options.path] = n;
    return handler(options, n);
  }

  @override
  void close({bool force = false}) {}
}

ApiClient _buildClient({
  required ResponseBody Function(RequestOptions options, int callNumberForThisPath) respond,
  required FakeTokenStorage tokenStorage,
  void Function()? onSessionExpired,
}) {
  final client = ApiClient(baseUrl: 'https://hatly.example/api/v1', tokenStorage: tokenStorage, onSessionExpired: onSessionExpired);
  client.dio.httpClientAdapter = _FakeAdapter(respond);
  return client;
}

void main() {
  group('ApiClient — M4 session expiry', () {
    test('CRITICAL: an irrecoverable 401 with no refresh token stored calls onSessionExpired exactly once', () async {
      final tokenStorage = FakeTokenStorage()..seed(access: 'expired-access', refresh: null);
      var sessionExpiredCalls = 0;
      final client = _buildClient(
        tokenStorage: tokenStorage,
        onSessionExpired: () => sessionExpiredCalls++,
        respond: (options, n) => ResponseBody.fromString('{"error":"unauthorized"}', 401, headers: {'content-type': ['application/json']}),
      );

      await expectLater(client.dio.get('/driver/deliveries'), throwsA(isA<DioException>()));

      expect(sessionExpiredCalls, 1);
    });

    test('CRITICAL: a 401 where the refresh call itself fails clears storage and calls onSessionExpired exactly once', () async {
      final tokenStorage = FakeTokenStorage()..seed(access: 'expired-access', refresh: 'stale-refresh');
      var sessionExpiredCalls = 0;
      final client = _buildClient(
        tokenStorage: tokenStorage,
        onSessionExpired: () => sessionExpiredCalls++,
        respond: (options, n) {
          if (options.path == '/auth/refresh') {
            return ResponseBody.fromString('{"error":"invalid refresh token"}', 401, headers: {'content-type': ['application/json']});
          }
          return ResponseBody.fromString('{"error":"unauthorized"}', 401, headers: {'content-type': ['application/json']});
        },
      );

      await expectLater(client.dio.get('/driver/deliveries'), throwsA(isA<DioException>()));

      expect(tokenStorage.cleared, isTrue);
      expect(sessionExpiredCalls, 1);
    });

    test('a 401 that successfully refreshes retries the original request ONCE and never calls onSessionExpired', () async {
      final tokenStorage = FakeTokenStorage()..seed(access: 'expired-access', refresh: 'valid-refresh');
      var sessionExpiredCalls = 0;
      final client = _buildClient(
        tokenStorage: tokenStorage,
        onSessionExpired: () => sessionExpiredCalls++,
        respond: (options, n) {
          if (options.path == '/auth/refresh') {
            return ResponseBody.fromString(
              '{"data":{"accessToken":"new-access","refreshToken":"new-refresh"}}',
              200,
              headers: {'content-type': ['application/json']},
            );
          }
          // /driver/deliveries: 401 on the first attempt, 200 on the retry.
          if (n == 1) return ResponseBody.fromString('{"error":"unauthorized"}', 401, headers: {'content-type': ['application/json']});
          return ResponseBody.fromString('{"data":[]}', 200, headers: {'content-type': ['application/json']});
        },
      );

      final response = await client.dio.get('/driver/deliveries');

      expect(response.statusCode, 200);
      expect(sessionExpiredCalls, 0);
      expect(await tokenStorage.accessToken, 'new-access');
      expect(tokenStorage.cleared, isFalse);
    });

    test('onSessionExpired is never called for a non-401 error', () async {
      final tokenStorage = FakeTokenStorage()..seed(access: 'valid-access', refresh: 'valid-refresh');
      var sessionExpiredCalls = 0;
      final client = _buildClient(
        tokenStorage: tokenStorage,
        onSessionExpired: () => sessionExpiredCalls++,
        respond: (options, n) => ResponseBody.fromString('{"error":"server error"}', 500, headers: {'content-type': ['application/json']}),
      );

      await expectLater(client.dio.get('/driver/deliveries'), throwsA(isA<DioException>()));

      expect(sessionExpiredCalls, 0);
      expect(tokenStorage.cleared, isFalse);
    });

    test('onSessionExpired is never called on a successful request', () async {
      final tokenStorage = FakeTokenStorage()..seed(access: 'valid-access', refresh: 'valid-refresh');
      var sessionExpiredCalls = 0;
      final client = _buildClient(
        tokenStorage: tokenStorage,
        onSessionExpired: () => sessionExpiredCalls++,
        respond: (options, n) => ResponseBody.fromString('{"data":[]}', 200, headers: {'content-type': ['application/json']}),
      );

      final response = await client.dio.get('/driver/deliveries');

      expect(response.statusCode, 200);
      expect(sessionExpiredCalls, 0);
    });
  });
}
