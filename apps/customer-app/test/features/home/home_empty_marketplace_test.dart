import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/auth/presentation/phone_verification_prompt_controller.dart';
import 'package:hatly_customer/features/cart/data/cart_api.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';
import 'package:hatly_customer/features/home/data/home_address_provider.dart';
import 'package:hatly_customer/features/home/data/home_banners_providers.dart';
import 'package:hatly_customer/features/home/domain/home_banner.dart';
import 'package:hatly_customer/features/home/data/home_providers.dart';
import 'package:hatly_customer/features/home/presentation/home_screen.dart';
import 'package:hatly_customer/features/sectors/domain/sector.dart';

import '../../support/test_app.dart';

/// A market with NO active category/store (what Production looked like on 2026-10-28: `GET /sectors` → `[]`). In a RELEASE build the
/// demo content is off, so Home used to render nothing but the Hatly Service card — indistinguishable from a broken app. These tests pin
/// the replacement: an honest empty notice, nothing invented, the Hatly Service entry still there, and no notice when data exists or
/// when the load merely FAILED (that case has its own retry state).
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

const _emptySnapshot = HomeSnapshot(popularVendors: [], productEntries: [], offers: [], promos: []);

List<Override> _overrides({Future<List<MarketplaceSector>> Function()? categories}) => [
      homeDemoEnabledProvider.overrideWithValue(false), // what a store build does: never invented content
      homeCategoriesProvider.overrideWith((ref) => (categories ?? () async => <MarketplaceSector>[])()),
      homeSnapshotProvider.overrideWith((ref) async => _emptySnapshot),
      homeBannersProvider.overrideWith((ref) async => <HomeBanner>[]),
      homeActiveAddressProvider.overrideWithValue(const AsyncData(null)),
      phoneVerificationStatusProvider.overrideWith((ref) async => true),
      cartApiProvider.overrideWithValue(_EmptyCartApi()),
    ];

void _phone(WidgetTester tester, {double width = 390, double height = 2400}) {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('no categories (Arabic): an honest notice is shown, the Hatly Service entry stays, nothing is invented', (tester) async {
    _phone(tester);
    await tester.pumpWidget(hatlyTestApp(const HomeScreen(), overrides: _overrides()));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));

    expect(find.byKey(const Key('home-no-stores')), findsOneWidget);
    expect(find.text('لا توجد متاجر متاحة بعد'), findsOneWidget);
    expect(find.textContaining('بمجرد توفرها في منطقتك'), findsOneWidget);
    expect(find.byKey(const Key('home-hatly-service-entry')), findsOneWidget);
    expect(find.text('تسوّق حسب الفئة'), findsNothing); // no empty "Shop by category" header over nothing
    expect(tester.takeException(), isNull);
  });

  testWidgets('no categories (English) shows the English notice', (tester) async {
    _phone(tester);
    await tester.pumpWidget(hatlyTestApp(const HomeScreen(), locale: const Locale('en'), overrides: _overrides()));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.text('No stores are available yet'), findsOneWidget);
    expect(find.textContaining('as soon as they open in your area'), findsOneWidget);
  });

  testWidgets('with categories the notice is NOT shown', (tester) async {
    _phone(tester);
    await tester.pumpWidget(hatlyTestApp(const HomeScreen(), overrides: _overrides(categories: () async => [const MarketplaceSector(id: 's1', name: 'Restaurants', nameAr: 'مطاعم', slug: 'restaurants', sortOrder: 0)])));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.byKey(const Key('home-no-stores')), findsNothing);
    expect(find.text('مطاعم'), findsOneWidget);
  });

  testWidgets('a FAILED category load is not announced as "no stores"', (tester) async {
    _phone(tester);
    await tester.pumpWidget(hatlyTestApp(const HomeScreen(), overrides: _overrides(categories: () async => throw Exception('offline'))));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.byKey(const Key('home-no-stores')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a FAILED category load says so with a Retry — it is not shown as an empty catalogue — and Retry loads the categories', (tester) async {
    _phone(tester);
    var calls = 0;
    await tester.pumpWidget(hatlyTestApp(const HomeScreen(), overrides: _overrides(categories: () async {
      calls++;
      if (calls == 1) throw Exception('offline');
      return [const MarketplaceSector(id: 's1', name: 'Restaurants', nameAr: 'مطاعم', slug: 'restaurants', sortOrder: 0)];
    })));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.byKey(const Key('home-categories-error')), findsOneWidget);
    expect(find.text('حدث خطأ ما'), findsWidgets);
    expect(find.byKey(const Key('home-no-stores')), findsNothing);
    await tester.tap(find.byKey(const Key('home-categories-retry')));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.byKey(const Key('home-categories-error')), findsNothing);
    expect(find.text('مطاعم'), findsOneWidget);
    expect(calls, 2);
  });

  for (final locale in const [Locale('ar'), Locale('en')]) {
    testWidgets('the notice lays out at 320 px wide and 2x text in ${locale.languageCode} without overflow', (tester) async {
      _phone(tester, width: 320);
      await tester.pumpWidget(hatlyTestApp(const HomeScreen(), locale: locale, textScale: 2.0, overrides: _overrides()));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(find.byKey(const Key('home-no-stores')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
