import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/auth/presentation/phone_verification_prompt_controller.dart';
import 'package:hatly_customer/features/cart/data/cart_api.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';
import 'package:hatly_customer/features/home/data/home_address_provider.dart';
import 'package:hatly_customer/features/home/data/home_banners_api.dart';
import 'package:hatly_customer/features/home/data/home_banners_providers.dart';
import 'package:hatly_customer/features/home/data/home_providers.dart';
import 'package:hatly_customer/features/home/domain/home_banner.dart';
import 'package:hatly_customer/features/home/presentation/home_screen.dart';
import 'package:hatly_customer/features/sectors/data/sectors_api.dart';
import 'package:hatly_customer/features/sectors/data/sectors_providers.dart';
import 'package:hatly_customer/features/sectors/domain/sector.dart';

import '../../support/test_app.dart';

/// What Home shows WHILE the slow, multi-request product composition (`homeSnapshotProvider`) is still loading or has failed. The banner
/// and the category grid depend only on their own requests, so they must be on screen as soon as those answer — and the loading state of
/// the rows below is an honest skeleton, never invented content. Also pins the request count (one sectors call, one banners call).
class _EmptyCartApi implements CartApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<Cart> getCart() async => const Cart(id: 'c', fulfillmentType: 'DELIVERY', groups: [], subtotalMinor: 0, hasUnpricedItems: false, readyForCheckout: false);
}

class _CountingSectorsApi implements SectorsApi {
  int calls = 0;
  Object? failure;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<MarketplaceSector>> getSectors() async {
    calls++;
    if (failure != null) throw failure!;
    return const [MarketplaceSector(id: 's1', name: 'Restaurants', nameAr: 'مطاعم ووجبات', slug: 'restaurants', sortOrder: 0)];
  }
}

class _CountingBannersApi implements HomeBannersApi {
  _CountingBannersApi(this.result);
  final Future<List<HomeBanner>> Function() result;
  int calls = 0;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<HomeBanner>> getBanners() {
    calls++;
    return result();
  }
}

const _banner = HomeBanner(id: 'b1', title: 'Order from local restaurants', titleAr: 'اطلب من مطاعم منطقتك', imageUrl: '/uploads/files/marketplace/banners/discover-restaurants.webp');

List<Override> _overrides({
  required _CountingSectorsApi sectors,
  required _CountingBannersApi banners,
  required Future<HomeSnapshot> Function() snapshot,
}) =>
    [
      homeDemoEnabledProvider.overrideWithValue(false),
      sectorsApiProvider.overrideWithValue(sectors),
      homeBannersApiProvider.overrideWithValue(banners),
      homeSnapshotProvider.overrideWith((ref) => snapshot()),
      homeActiveAddressProvider.overrideWithValue(const AsyncData(null)),
      phoneVerificationStatusProvider.overrideWith((ref) async => true),
      cartApiProvider.overrideWithValue(_EmptyCartApi()),
    ];

void _phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

const _empty = HomeSnapshot(popularVendors: [], productEntries: [], offers: [], promos: []);

void main() {
  testWidgets('while the product rows are STILL LOADING the banner and the categories are already on screen (and the rows show a skeleton)', (tester) async {
    _phone(tester);
    final pending = Completer<HomeSnapshot>();
    final sectors = _CountingSectorsApi();
    final banners = _CountingBannersApi(() async => [_banner]);
    await tester.pumpWidget(hatlyTestApp(const HomeScreen(), overrides: _overrides(sectors: sectors, banners: banners, snapshot: () => pending.future)));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.byKey(const Key('home-banner-b1')), findsOneWidget, reason: 'the banner must not wait for the product composition');
    expect(find.text('مطاعم ووجبات'), findsWidgets, reason: 'the categories must not wait either');
    expect(find.byKey(const Key('home-no-stores')), findsNothing);
    expect(sectors.calls, 1);
    expect(banners.calls, 1);

    pending.complete(_empty); // the rows arrive later; nothing above is requested again
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(sectors.calls, 1);
    expect(banners.calls, 1);
    expect(find.byKey(const Key('home-banner-b1')), findsOneWidget);
  });

  testWidgets('the banner request starts with the screen, in parallel with the sectors request — not after the product composition', (tester) async {
    _phone(tester);
    final pending = Completer<HomeSnapshot>();
    final sectors = _CountingSectorsApi();
    final banners = _CountingBannersApi(() async => [_banner]);
    await tester.pumpWidget(hatlyTestApp(const HomeScreen(), overrides: _overrides(sectors: sectors, banners: banners, snapshot: () => pending.future)));
    await tester.pump(); // first frame only
    expect(banners.calls, 1, reason: 'requested on the very first build');
    expect(sectors.calls, 1, reason: 'requested on the very first build');
    await tester.pumpWidget(const SizedBox()); // dispose the screen (its carousel timer) before the test ends
    await tester.pumpAndSettle(const Duration(seconds: 1));
  });

  testWidgets('a FAILED product composition leaves the banner and categories in place and shows ONE retry for the rows', (tester) async {
    _phone(tester);
    final sectors = _CountingSectorsApi();
    final banners = _CountingBannersApi(() async => [_banner]);
    await tester.pumpWidget(hatlyTestApp(const HomeScreen(), overrides: _overrides(sectors: sectors, banners: banners, snapshot: () async => throw Exception('products down'))));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));

    expect(find.byKey(const Key('home-banner-b1')), findsOneWidget);
    expect(find.text('مطاعم ووجبات'), findsWidgets);
    expect(find.text('إعادة المحاولة'), findsOneWidget, reason: 'one retry for the rows, not two');
  });

  testWidgets('when SECTORS fail, the category section owns the error + retry; the rows below do not repeat it; banners are unaffected', (tester) async {
    _phone(tester);
    final sectors = _CountingSectorsApi()..failure = Exception('offline');
    final banners = _CountingBannersApi(() async => [_banner]);
    await tester.pumpWidget(hatlyTestApp(const HomeScreen(), overrides: [
      ..._overrides(sectors: sectors, banners: banners, snapshot: () async => throw Exception('offline')),
    ]));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));

    expect(find.byKey(const Key('home-categories-error')), findsOneWidget);
    expect(find.text('إعادة المحاولة'), findsOneWidget);
    expect(find.byKey(const Key('home-banner-b1')), findsOneWidget);
  });

  testWidgets('empty banner response: no banner and no leftover skeleton; a failed banner request is silent; categories still show', (tester) async {
    _phone(tester);
    for (final fail in [false, true]) {
      await tester.pumpWidget(const SizedBox());
      final sectors = _CountingSectorsApi();
      final banners = _CountingBannersApi(() async => fail ? throw Exception('banners down') : <HomeBanner>[]);
      await tester.pumpWidget(hatlyTestApp(const HomeScreen(), overrides: _overrides(sectors: sectors, banners: banners, snapshot: () async => _empty)));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(find.byKey(const Key('home-banner-skeleton')), findsNothing, reason: fail ? 'failed' : 'empty');
      expect(find.byKey(const Key('home-banner-b1')), findsNothing);
      expect(find.text('مطاعم ووجبات'), findsWidgets);
      expect(tester.takeException(), isNull);
    }
  });
}
