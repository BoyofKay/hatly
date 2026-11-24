import 'dart:convert';
import 'dart:typed_data';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/shared_widgets/looping_pager.dart';
import 'package:hatly_customer/shared_widgets/home_hero_artwork.dart';
import 'package:hatly_customer/shared_widgets/hatly_soft_image.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/network/api_client.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/core/storage/token_storage.dart';
import 'package:hatly_customer/features/home/data/home_banners_api.dart';
import 'package:hatly_customer/features/home/data/home_banners_providers.dart';
import 'package:hatly_customer/features/home/domain/home_banner.dart';
import 'package:hatly_customer/features/home/domain/home_content.dart';
import 'package:hatly_customer/features/home/presentation/widgets/home_banner_section.dart';
import 'package:hatly_customer/features/home/presentation/widgets/home_promo_actions.dart';
import 'package:hatly_customer/features/home/presentation/widgets/promo_carousel.dart';

import '../../support/router_test_app.dart';

/// Admin-managed Home banners on the customer side: parsing what the server sends, the request itself, where a tap leads, and what
/// the customer sees while loading, with banners, with none, and when the request fails. (The server side is proven by the backend
/// e2e `108-home-banners`.)

class _Tokens extends TokenStorage {
  @override
  Future<String?> get accessToken async => null;
}

class _Adapter implements HttpClientAdapter {
  _Adapter(this.respond);
  final ResponseBody Function(RequestOptions) respond;
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    return respond(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(Object body, [int status = 200]) =>
    ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});

HomeBanner _banner(String id, {String title = 'Weekend offers', String? titleAr, HomeBannerAction action = HomeBannerAction.none, String? target, String image = '/uploads/files/a.png'}) =>
    HomeBanner(id: id, title: title, titleAr: titleAr, imageUrl: image, action: action, targetId: target);

const _promos = [HomePromo(id: 'p1', kind: HomePromoKind.offer, title: 'عرض المنتج')];

void main() {
  group('parsing what the server sends', () {
    test('a complete item', () {
      final b = HomeBanner.tryParse({'id': 'b1', 'title': ' Eid ', 'titleAr': ' عيد ', 'imageUrl': '/uploads/files/x.png', 'actionType': 'PRODUCT', 'actionTargetId': 'p9'})!;
      expect((b.id, b.title, b.titleAr, b.imageUrl, b.action, b.targetId), ('b1', 'Eid', 'عيد', '/uploads/files/x.png', HomeBannerAction.product, 'p9'));
      expect(b.isTappable, isTrue);
    });

    test('an item that cannot be shown safely is dropped, never thrown: no id, title or image, or not an object', () {
      for (final bad in <Object?>[null, 'x', 3, <String, Object?>{}, {'id': 'b', 'title': 'T'}, {'id': 'b', 'imageUrl': '/u.png'}, {'title': 'T', 'imageUrl': '/u.png'}, {'id': 'b', 'title': '  ', 'imageUrl': '/u.png'}, {'id': 'b', 'title': 'T', 'imageUrl': ' '}]) {
        expect(HomeBanner.tryParse(bad), isNull, reason: '$bad');
      }
    });

    test('an unknown destination type, or one without a target, makes the banner non-tappable instead of failing', () {
      final unknown = HomeBanner.tryParse({'id': 'b', 'title': 'T', 'imageUrl': '/u.png', 'actionType': 'URL', 'actionTargetId': 'http://evil.example'})!;
      expect(unknown.action, HomeBannerAction.none);
      expect(unknown.isTappable, isFalse);
      final noTarget = HomeBanner.tryParse({'id': 'b', 'title': 'T', 'imageUrl': '/u.png', 'actionType': 'VENDOR'})!;
      expect(noTarget.isTappable, isFalse);
    });

    test('the title shown follows the language and falls back to English', () {
      expect(_banner('b', titleAr: 'عروض').displayTitle(true), 'عروض');
      expect(_banner('b', titleAr: 'عروض').displayTitle(false), 'Weekend offers');
      expect(_banner('b').displayTitle(true), 'Weekend offers');
      expect(_banner('b', titleAr: '  ').displayTitle(true), 'Weekend offers');
    });
  });

  group('the request', () {
    ApiClient clientWith(_Adapter adapter) {
      final client = ApiClient(baseUrl: 'https://api.test/api/v1', tokenStorage: _Tokens());
      client.dio.httpClientAdapter = adapter;
      return client;
    }

    test('asks GET /home-banners (public — no account needed) and keeps the server order, skipping a malformed item', () async {
      final adapter = _Adapter((_) => _json({
            'data': [
              {'id': 'b1', 'title': 'One', 'imageUrl': '/uploads/files/1.png', 'actionType': 'NONE', 'actionTargetId': null},
              {'id': 'broken'},
              {'id': 'b3', 'title': 'Three', 'imageUrl': '/uploads/files/3.png', 'actionType': 'SECTOR', 'actionTargetId': 's1'},
            ]
          }));
      final banners = await HomeBannersApi(clientWith(adapter)).getBanners();
      expect(adapter.requests.single.path, '/home-banners');
      expect(adapter.requests.single.method, 'GET');
      expect(adapter.requests.single.headers.containsKey('Authorization'), isFalse);
      expect(banners.map((b) => b.id), ['b1', 'b3']);
    });

    test('an empty list, and an unexpected payload shape, are an empty result (not an error)', () async {
      expect(await HomeBannersApi(clientWith(_Adapter((_) => _json({'data': []})))).getBanners(), isEmpty);
      expect(await HomeBannersApi(clientWith(_Adapter((_) => _json({'data': {'oops': 1}})))).getBanners(), isEmpty);
    });

    test('a server error is an ApiException the caller can treat as "banners unavailable"', () async {
      final api = HomeBannersApi(clientWith(_Adapter((_) => _json({'error': {'code': 'INTERNAL_ERROR', 'message': 'boom'}}, 500))));
      await expectLater(api.getBanners(), throwsA(isA<ApiException>()));
    });
  });

  group('where a tap leads (existing routes only)', () {
    test('product → product page, vendor → vendor page, sector → that sector\'s vendor list titled by the banner', () {
      expect(bannerRoute(_banner('b', action: HomeBannerAction.product, target: 'p1'), arabic: false), '/products/p1');
      expect(bannerRoute(_banner('b', action: HomeBannerAction.vendor, target: 'v1'), arabic: false), '/vendors/v1');
      expect(bannerRoute(_banner('b', title: 'Pharmacies', action: HomeBannerAction.sector, target: 's1'), arabic: false), '/vendors?sectorId=s1&sectorName=Pharmacies');
      final ar = bannerRoute(_banner('b', title: 'x', titleAr: 'صيدليات', action: HomeBannerAction.sector, target: 's1'), arabic: true)!;
      expect(Uri.parse(ar).queryParameters, {'sectorId': 's1', 'sectorName': 'صيدليات'});
    });

    test('an informative banner (or one without a usable target) leads nowhere', () {
      expect(bannerRoute(_banner('b'), arabic: false), isNull);
      expect(bannerRoute(_banner('b', action: HomeBannerAction.product), arabic: false), isNull);
    });
  });

  group('HomeBannerSection states', () {
    Future<void> pump(WidgetTester tester, Future<List<HomeBanner>> Function() banners,
        {List<HomePromo> promos = const [], Locale locale = const Locale('ar'), double width = 390, double scale = 1.0, List<String>? visited, bool extended = false}) async {
      tester.view.physicalSize = Size(width, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(const SizedBox()); // a fresh ProviderScope each time (a cached provider value would leak between steps)
      await tester.pumpWidget(hatlyRouterApp(
        locale: locale,
        textScale: scale,
        overrides: [homeBannersProvider.overrideWith((ref) => banners())],
        routes: [
          GoRoute(path: '/', builder: (c, s) => Scaffold(body: SingleChildScrollView(child: HomePinnedSearchScope(pinned: extended, hasArtwork: extended, child: HomeBannerSection(fallbackPromos: promos, onPromoAction: (_) {}))))),
          GoRoute(path: '/products/:id', builder: (c, s) { visited?.add(s.uri.toString()); return const Scaffold(body: Text('product page')); }),
          GoRoute(path: '/vendors/:id', builder: (c, s) { visited?.add(s.uri.toString()); return const Scaffold(body: Text('vendor page')); }),
          GoRoute(path: '/vendors', builder: (c, s) { visited?.add(s.uri.toString()); return const Scaffold(body: Text('vendor list')); }),
        ],
      ));
    }

    testWidgets('while loading it reserves the banner\'s height with a placeholder (no layout jump)', (tester) async {
      final never = Future<List<HomeBanner>>.delayed(const Duration(hours: 1), () => []);
      await pump(tester, () => never);
      await tester.pump();
      expect(find.byKey(const Key('home-banner-skeleton')), findsOneWidget);
      await tester.pumpWidget(const SizedBox()); // dispose before the long timer matters
      await tester.pump(const Duration(hours: 2));
    });

    testWidgets('banners are shown in the server order without page dots, and REPLACE the offer-derived promos', (tester) async {
      await pump(tester, () async => [_banner('b1', titleAr: 'الأول'), _banner('b2', titleAr: 'التاني')], promos: _promos);
      await tester.pumpAndSettle();
      expect(find.byType(HomeBannerCarousel), findsOneWidget);
      expect(find.byType(PromoCarousel), findsNothing);
      expect(find.byKey(const Key('home-banner-b1')), findsOneWidget);
      expect(find.byType(PromoPageIndicator), findsNothing); // no dots, even with several banners (owner, 2026-11-11)
      expect(find.bySemanticsLabel('الأول'), findsOneWidget); // the accessible label is the (Arabic) title
    });

    for (final width in [320.0, 360.0, 375.0, 390.0, 430.0]) {
      for (final locale in const [Locale('ar'), Locale('en')]) {
        testWidgets('the carousel uses a full-width edge-to-edge hero (\u0024{width.toInt()} pt, \u0024{locale.languageCode})', (tester) async {
          await pump(tester, () async => [_banner('b1'), _banner('b2'), _banner('b3')], width: width, locale: locale);
          await tester.pumpAndSettle();
          final card = tester.getRect(find.byKey(const Key('home-banner-b1')));
          expect(card.width, closeTo(width, 0.5));
          expect(card.left, closeTo(0, 0.5));
          expect(width - card.right, closeTo(0, 0.5));
          expect(card.height, closeTo(bannerHeight(width), 0.5));
          expect(tester.takeException(), isNull);
        });
      }
    }

        testWidgets('the new wide hero stays within compact height bounds and preserves cover-fit', (tester) async {
      expect(bannerHeight(390), closeTo(251.61, 0.5));
      expect(bannerHeight(320), closeTo(206.45, 0.2)); // full-width banner
      await pump(tester, () async => [_banner('b1')]);
      await tester.pumpAndSettle();
      final image = tester.widget<HatlySoftImage>(find.byType(HatlySoftImage));
      expect(image.fit, BoxFit.cover);
    });

    testWidgets('swiping still moves to the next banner, and it rotates on its own every 5 s with a 0.9 s glide', (tester) async {
      await pump(tester, () async => [_banner('b1'), _banner('b2')]);
      await tester.pumpAndSettle();
      final start = tester.widget<PageView>(find.byType(PageView)).controller!.page!;
      await tester.fling(find.byType(PageView), const Offset(-300, 0), 1000);
      await tester.pumpAndSettle();
      final afterSwipe = tester.widget<PageView>(find.byType(PageView)).controller!.page!;
      expect(afterSwipe, isNot(start));
      expect(tester.widget<LoopingPager>(find.byType(LoopingPager)).autoPlayGlide,
          const Duration(milliseconds: 900));
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(tester.widget<PageView>(find.byType(PageView)).controller!.page!, isNot(afterSwipe));
      expect(find.byType(PromoPageIndicator), findsNothing);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('extended promotion is one square artwork inside a single pager', (tester) async {
      await pump(tester, () async => [_banner('b1'), _banner('b2')], extended: true);
      await tester.pumpAndSettle();
      final card = find.byKey(const Key('home-banner-b1'));
      expect(tester.getSize(card).width, closeTo(390, .5));
      expect(tester.getSize(card).height, closeTo(390, .5));
      expect(find.byType(PageView), findsOneWidget);
      expect(find.descendant(of: card, matching: find.byType(HatlySoftImage)), findsOneWidget);
      await tester.fling(find.byType(PageView), const Offset(-300, 0), 1000);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('home-banner-b2')), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a single banner has no page dots and does not auto-rotate', (tester) async {
      await pump(tester, () async => [_banner('only')]);
      await tester.pumpAndSettle();
      expect(find.byType(PromoPageIndicator), findsNothing);
      await tester.pump(const Duration(seconds: 12));
      expect(find.byKey(const Key('home-banner-only')), findsOneWidget);
    });

    testWidgets('the image is requested at the absolute URL of the server\'s stable upload path', (tester) async {
      await pump(tester, () async => [_banner('b1', image: '/uploads/files/abc.png')]);
      await tester.pumpAndSettle();
      final image = tester.widget<CachedNetworkImage>(find.byType(CachedNetworkImage));
      expect(Uri.parse(image.imageUrl).path, '/uploads/files/abc.png');
      expect(Uri.parse(image.imageUrl).hasScheme, isTrue);
    });

    testWidgets('an unusable image reference (non-http scheme, protocol-relative, bare path) shows the placeholder and no request', (tester) async {
      for (final bad in ['javascript:alert(1)', 'stub-upload://x', '//evil.example/x.png', 'uploads/x.png']) {
        await pump(tester, () async => [_banner('b1', image: bad)]);
        await tester.pumpAndSettle();
        expect(find.byType(CachedNetworkImage), findsNothing, reason: bad);
        expect(find.byIcon(Icons.local_offer_outlined), findsOneWidget, reason: bad);
        expect(tester.widget<Icon>(find.byIcon(Icons.local_offer_outlined)).size, greaterThan(0), reason: 'fallback must be visible: $bad');
        expect(tester.takeException(), isNull, reason: bad);
      }
    });

    testWidgets('tapping goes to the product, vendor or sector page; an informative banner is not a button and goes nowhere', (tester) async {
      final visited = <String>[];
      await pump(tester, () async => [_banner('b1', action: HomeBannerAction.product, target: 'p7')], visited: visited);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('home-banner-b1')));
      await tester.pumpAndSettle();
      expect(visited, ['/products/p7']);
      expect(find.text('product page'), findsOneWidget);

      visited.clear();
      await pump(tester, () async => [_banner('b2', title: 'Vendors', action: HomeBannerAction.vendor, target: 'v3')], visited: visited);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('home-banner-b2')));
      await tester.pumpAndSettle();
      expect(visited, ['/vendors/v3']);

      visited.clear();
      await pump(tester, () async => [_banner('b3', title: 'Pharmacies', action: HomeBannerAction.sector, target: 's1')], visited: visited, locale: const Locale('en'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('home-banner-b3')));
      await tester.pumpAndSettle();
      expect(visited.single, '/vendors?sectorId=s1&sectorName=Pharmacies');

      visited.clear();
      await pump(tester, () async => [_banner('info')], visited: visited);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('home-banner-info')), warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(visited, isEmpty);
      final semantics = tester.getSemantics(find.bySemanticsLabel('Weekend offers'));
      expect(semantics.getSemanticsData().flagsCollection.isButton, isFalse);
    });

    testWidgets('no banners → the offer-derived promos are shown exactly as before; nothing at all → no space is taken', (tester) async {
      await pump(tester, () async => <HomeBanner>[], promos: _promos);
      await tester.pumpAndSettle();
      expect(find.byType(PromoCarousel), findsOneWidget);
      expect(find.byType(HomeBannerCarousel), findsNothing);

      await pump(tester, () async => <HomeBanner>[]);
      await tester.pumpAndSettle();
      expect(find.byType(PromoCarousel), findsNothing);
      expect(find.byType(HomeBannerCarousel), findsNothing);
      expect(tester.getSize(find.byType(HomeBannerSection)).height, 0);
    });

    testWidgets('a FAILED banner request is not an error for the customer: Home quietly keeps the promos (or nothing) — no exception', (tester) async {
      await pump(tester, () async => throw Exception('offline'), promos: _promos);
      await tester.pumpAndSettle();
      expect(find.byType(PromoCarousel), findsOneWidget);
      expect(find.byType(HomeBannerCarousel), findsNothing);
      expect(tester.takeException(), isNull);

      await pump(tester, () async => throw Exception('offline'));
      await tester.pumpAndSettle();
      expect(tester.getSize(find.byType(HomeBannerSection)).height, 0);
    });

    for (final locale in const [Locale('ar'), Locale('en')]) {
      testWidgets('lays out at 320 px wide and 2x text in ${locale.languageCode} without overflow, several banners', (tester) async {
        await pump(tester, () async => [_banner('b1', titleAr: 'عنوان طويل جدًا لا يجب أن يكسر التصميم أبدًا'), _banner('b2'), _banner('b3')], locale: locale, width: 320, scale: 2.0);
        await tester.pumpAndSettle();
        expect(find.byType(HomeBannerCarousel), findsOneWidget);
        expect(tester.takeException(), isNull);
        final box = tester.getSize(find.byKey(const Key('home-banner-b1')));
        expect(box.height, greaterThanOrEqualTo(120));
        expect(box.width, closeTo(320, 0.5)); // full bleed
      });
    }
  });
}
