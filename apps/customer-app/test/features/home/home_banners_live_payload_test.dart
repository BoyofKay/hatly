import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/api_client.dart';
import 'package:hatly_customer/core/storage/token_storage.dart';
import 'package:hatly_customer/features/home/data/home_banners_api.dart';
import 'package:hatly_customer/features/home/domain/home_banner.dart';
import 'package:hatly_customer/features/home/presentation/widgets/home_promo_actions.dart';

/// The Home banners exactly as Production served them on 2026-10-31: five demo category banners (webp) plus the banner the owner
/// published from the Admin Panel (a PRODUCT target, a 1981×793 PNG upload, Arabic title). Every one must parse, keep the server order,
/// resolve to a stable upload URL, and lead somewhere sensible — none may be silently dropped by the app.

class _Tokens extends TokenStorage {
  @override
  Future<String?> get accessToken async => null;
}

class _Adapter implements HttpClientAdapter {
  _Adapter(this.body);
  final String body;
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async =>
      ResponseBody.fromString(body, 200, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
  @override
  void close({bool force = false}) {}
}

void main() {
  test('all six live banners parse in server order, with the owner-published PRODUCT banner first and tappable', () async {
    final raw = File('test/fixtures/production_home_banners_2026_10_31.json').readAsStringSync();
    final client = ApiClient(baseUrl: 'https://api.hatly.dev/api/v1', tokenStorage: _Tokens());
    client.dio.httpClientAdapter = _Adapter(raw);
    final banners = await HomeBannersApi(client).getBanners();

    final sent = (jsonDecode(raw)['data'] as List).length;
    expect(banners.length, sent, reason: 'the app must not silently drop any banner the server sent');
    expect(banners.first.id, 'b9ace18f-fc37-4357-82ef-eb851bbde960');
    expect(banners.first.imageUrl, endsWith('.png'));
    expect(banners.first.action, HomeBannerAction.product);
    expect(banners.first.isTappable, isTrue);
    expect(bannerRoute(banners.first, arabic: true), '/products/b61880b2-d342-4fcf-a5f1-edeb4eb3ebb1');
    expect(banners.first.displayTitle(true), 'عرض على السكر');
    for (final b in banners) {
      expect(b.imageUrl.startsWith('/uploads/files/'), isTrue, reason: b.id);
      expect(b.isTappable, isTrue, reason: b.id);
    }
  });
}
