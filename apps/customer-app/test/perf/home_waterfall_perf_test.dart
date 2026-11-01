// Measures how the Home screen's data loads over a REAL network, using the app's own providers/repositories (no UI).
// It is skipped unless run explicitly against a backend:
//   flutter test test/perf/home_waterfall_perf_test.dart --dart-define=HATLY_PERF=true --dart-define=API_BASE_URL=https://api.hatly.dev/api/v1
// Only public GET endpoints are called (sectors, vendors, products, home/product-sections); nothing is written and no account is used.
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/config/api_config.dart';
import 'package:hatly_customer/core/network/api_client.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/core/network/providers.dart';
import 'package:hatly_customer/core/storage/token_storage.dart';
import 'package:hatly_customer/features/home/data/home_product_sections_api.dart';
import 'package:hatly_customer/features/home/data/home_providers.dart';
import 'package:hatly_customer/features/home/domain/home_content.dart';

const _enabled = bool.fromEnvironment('HATLY_PERF');

class _NoTokens extends TokenStorage {
  @override
  Future<String?> get accessToken async => null;
  @override
  Future<String?> get refreshToken async => null;
}

class _Timeline {
  final sw = Stopwatch()..start();
  final requests = <({String path, int startMs, int endMs, int status})>[];
  final marks = <String, int>{};
  void mark(String name) => marks.putIfAbsent(name, () => sw.elapsedMilliseconds);
  void interceptor(Dio dio) {
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (o, h) {
        o.extra['t0'] = sw.elapsedMilliseconds;
        h.next(o);
      },
      onResponse: (r, h) {
        requests.add((path: '${r.requestOptions.path}${r.requestOptions.queryParameters.isEmpty ? '' : '?${r.requestOptions.queryParameters.entries.map((e) => '${e.key}=${e.value}').join('&')}'}', startMs: r.requestOptions.extra['t0'] as int, endMs: sw.elapsedMilliseconds, status: r.statusCode ?? 0));
        h.next(r);
      },
      onError: (e, h) {
        requests.add((path: e.requestOptions.path, startMs: e.requestOptions.extra['t0'] as int? ?? 0, endMs: sw.elapsedMilliseconds, status: e.response?.statusCode ?? -1));
        h.next(e);
      },
    ));
  }

  String report(String title) {
    final b = StringBuffer('\n===== $title =====\n');
    marks.forEach((k, v) => b.writeln('  mark  ${v.toString().padLeft(6)} ms  $k'));
    requests.sort((a, b) => a.startMs.compareTo(b.startMs));
    for (final r in requests) {
      b.writeln('  req   start ${r.startMs.toString().padLeft(6)}  end ${r.endMs.toString().padLeft(6)}  (${(r.endMs - r.startMs).toString().padLeft(5)} ms)  ${r.status}  ${r.path}');
    }
    b.writeln('  requests: ${requests.length}, total wall: ${sw.elapsedMilliseconds} ms');
    return b.toString();
  }
}

// ignore: unused_element
ProviderContainer _container(_Timeline t) => ProviderContainer(overrides: [
      apiClientProvider.overrideWith((ref) {
        final client = ApiClient(baseUrl: kApiBaseUrl, tokenStorage: _NoTokens());
        t.interceptor(client.dio);
        return client;
      }),
    ]);

class _Forced404Api implements HomeProductSectionsApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  @override
  Future<HomeProductSectionsResult> fetch({Set<HomeSectionKind>? sections}) async =>
      throw const ApiException(code: 'NOT_FOUND', message: 'forced 404 -> the previous multi-request composition', statusCode: 404);
}

void main() {
  setUpAll(() => HttpOverrides.global = null); // flutter_test blocks real HTTP by default
  const skip = !_enabled ? 'perf harness: pass --dart-define=HATLY_PERF=true' : false;

  // LEGACY: the real previous composition (sectors -> 3 vendor lists -> 18 product lists), reached by forcing the aggregation endpoint to 404.
  // AGGREGATION: the real single request. Both build the real HomeSnapshot with the app's own providers over a real network.
  for (final legacy in [true, false]) {
    test(legacy ? 'LEGACY (previous multi-request composition)' : 'AGGREGATION (GET /home/product-sections)', () async {
      final t = _Timeline();
      final c = ProviderContainer(overrides: [
        homeDemoEnabledProvider.overrideWithValue(false), // measure real data only — never the demo fill a debug build would add
        apiClientProvider.overrideWith((ref) {
          final client = ApiClient(baseUrl: kApiBaseUrl, tokenStorage: _NoTokens());
          t.interceptor(client.dio);
          return client;
        }),
        if (legacy) homeProductSectionsApiProvider.overrideWithValue(_Forced404Api()),
      ]);
      addTearDown(c.dispose);
      final sub = c.listen(homeSnapshotProvider, (_, __) {});
      final snapshot = await c.read(homeSnapshotProvider.future);
      t.mark('all three product rows ready');
      sub.close();
      // ignore: avoid_print
      print(t.report('${legacy ? 'LEGACY' : 'AGGREGATION'}  api=$kApiBaseUrl  entries=${snapshot.productEntries.length} offers=${snapshot.offers.length}'));
    }, skip: skip, timeout: const Timeout(Duration(minutes: 2)));
  }
}
