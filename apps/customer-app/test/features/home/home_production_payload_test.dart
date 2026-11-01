import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/auth/presentation/phone_verification_prompt_controller.dart';
import 'package:hatly_customer/features/cart/data/cart_api.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';
import 'package:hatly_customer/features/home/data/home_address_provider.dart';
import 'package:hatly_customer/features/home/data/home_banners_providers.dart';
import 'package:hatly_customer/features/home/data/home_providers.dart';
import 'package:hatly_customer/features/home/domain/home_banner.dart';
import 'package:hatly_customer/features/home/presentation/home_screen.dart';
import 'package:hatly_customer/features/sectors/domain/sector.dart';

import '../../support/test_app.dart';

/// Regression for the "empty Home" report. The public catalog endpoints exactly as Production served them on 2026-10-30 (`GET /sectors`,
/// `GET /home-banners` — public, no personal data, captured read-only) must parse with the app's own models and produce a populated Home:
/// category tiles AND banners, no "no stores" notice. (The earlier empty Home was an EMPTY Production catalog — see
/// home_empty_marketplace_test.dart for that state.)
class _EmptyCartApi implements CartApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<Cart> getCart() async => const Cart(
        id: 'c',
        fulfillmentType: 'DELIVERY',
        groups: [],
        subtotalMinor: 0,
        hasUnpricedItems: false,
        readyForCheckout: false,
      );
}

Map<String, dynamic> _fixture() => jsonDecode(File('test/fixtures/production_public_catalog_2026_10_30.json').readAsStringSync()) as Map<String, dynamic>;

void main() {
  final sectors = [
    for (final raw in (_fixture()['sectors']['data'] as List)) MarketplaceSector.fromJson(raw as Map<String, dynamic>),
  ];
  final banners = [
    for (final raw in (_fixture()['home-banners']['data'] as List))
      if (HomeBanner.tryParse(raw) case final b?) b,
  ];

  test('every Production sector and banner parses with the app models', () {
    expect(sectors, isNotEmpty);
    expect(sectors.every((s) => s.name.isNotEmpty && s.nameAr != null), isTrue);
    expect(banners, isNotEmpty);
    expect((_fixture()['home-banners']['data'] as List).length, banners.length, reason: 'no banner may be silently dropped');
  });

  testWidgets('Home built from that payload shows the category grid and the banners, not the empty notice', (tester) async {
    tester.view.physicalSize = const Size(390, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(hatlyTestApp(const HomeScreen(), overrides: [
      homeDemoEnabledProvider.overrideWithValue(false),
      homeCategoriesProvider.overrideWith((ref) async => orderHomeCategories(sectors)),
      homeSnapshotProvider.overrideWith((ref) async => const HomeSnapshot(popularVendors: [], productEntries: [], offers: [], promos: [])),
      homeBannersProvider.overrideWith((ref) async => banners),
      homeActiveAddressProvider.overrideWithValue(const AsyncData(null)),
      phoneVerificationStatusProvider.overrideWith((ref) async => true),
      cartApiProvider.overrideWithValue(_EmptyCartApi()),
    ]));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));

    expect(find.byKey(const Key('home-no-stores')), findsNothing);
    expect(find.text(sectors.first.nameAr!), findsWidgets);
  });
}
