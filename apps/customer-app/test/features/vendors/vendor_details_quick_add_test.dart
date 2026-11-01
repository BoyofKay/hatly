import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/features/auth/presentation/auth_gate.dart';
import 'package:hatly_customer/features/cart/data/cart_api.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/products/data/product_providers.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/features/products/domain/product_category.dart';
import 'package:hatly_customer/features/products/domain/product_option.dart';
import 'package:hatly_customer/features/vendors/data/vendor_providers.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_branch_summary.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_details.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_profile.dart';
import 'package:hatly_customer/features/vendors/presentation/vendor_details_screen.dart';

/// Visual UX (reference comparison) — the vendor page: the real rating in the header, the menu search ahead of the menu
/// sections, and a one-tap "+" on simple menu items that goes through the SAME cart path as Home (one unit; a weighted
/// product or one with options never gets the "+"; a backend "choose first" answer hands off to the product page).

class _NoCartApi implements CartApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

class _FakeCart extends CartController {
  _FakeCart() : super(_NoCartApi(), signedIn: false);
  final calls = <({String productId, int quantity, int? grams})>[];
  ApiException? next;
  @override
  Future<ApiException?> addItem({
    required String productId,
    required int quantity,
    List<String>? selectedOptionValueIds,
    String? notes,
    int? requestedWeightGrams,
  }) async {
    calls.add((
      productId: productId,
      quantity: quantity,
      grams: requestedWeightGrams
    ));
    return next;
  }
}

const _option = ProductOption(
    id: 'o1',
    name: 'Size',
    isRequired: true,
    allowsMultiple: false,
    values: [
      ProductOptionValue(id: 'v1', name: 'Large', priceDeltaMinor: 500),
    ]);

const _products = [
  Product(
      id: 'simple',
      vendorBranchId: 'b1',
      categoryId: 'c1',
      name: 'Kebab',
      priceMinor: 12000,
      isAvailable: true),
  Product(
      id: 'weighted',
      vendorBranchId: 'b1',
      categoryId: 'c1',
      name: 'Kofta',
      priceMinor: 30000,
      isAvailable: true,
      pricingUnit: 'WEIGHT'),
  Product(
      id: 'options',
      vendorBranchId: 'b1',
      categoryId: 'c1',
      name: 'Shawarma',
      priceMinor: 8000,
      isAvailable: true,
      options: [_option]),
  Product(
      id: 'off',
      vendorBranchId: 'b1',
      categoryId: 'c1',
      name: 'Soup',
      priceMinor: 4000,
      isAvailable: false),
];

VendorDetails _details({int ratingCount = 0, double ratingAverage = 0}) =>
    VendorDetails(
      vendor:
          const VendorProfile(id: 'v1', name: 'Abu Aly Grills', category: ''),
      branch: const VendorBranchSummary(
          id: 'b1',
          vendorId: 'v1',
          name: 'Abu Aly Grills',
          address: 'Main St',
          latitude: 30,
          longitude: 31,
          isOpen: true,
          openingHours: {}),
      ratingAverage: ratingAverage,
      ratingCount: ratingCount,
      etaMinMinutes: 0,
      etaMaxMinutes: 0,
      deliveryFeeMinor: 0,
    );

Future<_FakeCart> _pump(WidgetTester tester,
    {VendorDetails? details,
    bool signedIn = true,
    double width = 390,
    double textScale = 1}) async {
  HatlyTypography.useGoogleFonts = false;
  tester.view.physicalSize = Size(width * 3, 2000 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final cart = _FakeCart();
  final router = GoRouter(initialLocation: '/vendors/b1', routes: [
    GoRoute(
        path: '/vendors/:id',
        builder: (_, s) =>
            VendorDetailsScreen(vendorId: s.pathParameters['id']!)),
    GoRoute(
        path: '/products/:id',
        builder: (_, s) =>
            Scaffold(body: Text('product page ${s.pathParameters['id']}'))),
    GoRoute(
        path: '/phone',
        builder: (_, __) => const Scaffold(body: Text('sign-in page'))),
    GoRoute(
        path: '/cart',
        builder: (_, __) => const Scaffold(body: Text('cart page'))),
  ]);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      isSignedInProvider.overrideWithValue(signedIn),
      cartControllerProvider.overrideWith((ref) => cart),
      vendorDetailsProvider('b1')
          .overrideWith((ref) async => details ?? _details()),
      productCategoriesProvider('b1').overrideWith((ref) async => const [
            ProductCategoryInfo(id: 'c1', name: 'Grills', nameAr: 'مشويات')
          ]),
      productListProvider.overrideWith((ref, params) async => _products),
    ],
    child: MaterialApp.router(
      routerConfig: router,
      theme: HatlyTheme.light(),
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar'), Locale('en')],
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, w) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(textScale)),
        child: w!,
      ),
    ),
  ));
  await tester.pumpAndSettle();
  return cart;
}

void main() {
  testWidgets(
      '"+" only on simple, available items — never on weighted, optioned or unavailable ones',
      (tester) async {
    await _pump(tester);
    expect(find.byKey(const Key('product-quick-add-simple')), findsOneWidget);
    expect(find.byKey(const Key('product-quick-add-weighted')), findsNothing);
    expect(find.byKey(const Key('product-quick-add-options')), findsNothing);
    expect(find.byKey(const Key('product-quick-add-off')), findsNothing);
  });

  testWidgets(
      'tapping "+" adds ONE unit through the cart controller and confirms, without leaving the menu',
      (tester) async {
    final cart = await _pump(tester);
    await tester.tap(find.byKey(const Key('product-quick-add-simple')));
    await tester.pump();
    expect(cart.calls, [(productId: 'simple', quantity: 1, grams: null)]);
    expect(find.text('تمت الإضافة إلى السلة'), findsOneWidget);
    expect(find.text('product page simple'), findsNothing);
  });

  testWidgets(
      'the backend asks for a choice (OPTION_REQUIRED) → the product page opens instead',
      (tester) async {
    final cart = await _pump(tester);
    cart.next = const ApiException(
        code: 'BAD_REQUEST',
        message: 'x',
        details: {'code': 'OPTION_REQUIRED'});
    await tester.tap(find.byKey(const Key('product-quick-add-simple')));
    await tester.pumpAndSettle();
    expect(find.text('product page simple'), findsOneWidget);
  });

  testWidgets(
      'another branch already in the cart (CART_BRANCH_CONFLICT) → the product page, which owns that flow',
      (tester) async {
    final cart = await _pump(tester);
    cart.next = const ApiException(
        code: 'CONFLICT',
        message: 'x',
        details: {'code': 'CART_BRANCH_CONFLICT'});
    await tester.tap(find.byKey(const Key('product-quick-add-simple')));
    await tester.pumpAndSettle();
    expect(find.text('product page simple'), findsOneWidget);
  });

  testWidgets('a guest tapping "+" is sent to sign-in and nothing is added',
      (tester) async {
    final cart = await _pump(tester, signedIn: false);
    await tester.tap(find.byKey(const Key('product-quick-add-simple')));
    await tester.pumpAndSettle();
    expect(cart.calls, isEmpty);
    expect(find.text('sign-in page'), findsOneWidget);
  });

  testWidgets('tapping the item itself still opens its product page',
      (tester) async {
    await _pump(tester);
    await tester.tap(find.text('Kebab'));
    await tester.pumpAndSettle();
    expect(find.text('product page simple'), findsOneWidget);
  });

  testWidgets(
      'hierarchy: the menu search sits above the menu sections, which sit above the products',
      (tester) async {
    await _pump(tester);
    final searchY =
        tester.getTopLeft(find.byKey(const Key('product-filter-action'))).dy;
    final chipsY = tester.getTopLeft(find.text('مشويات')).dy;
    final firstProductY = tester.getTopLeft(find.text('Kebab')).dy;
    expect(searchY, lessThan(chipsY));
    expect(chipsY, lessThan(firstProductY));
  });

  testWidgets(
      'header shows the REAL rating when there is one, and nothing when there is none',
      (tester) async {
    await _pump(tester,
        details: _details(ratingCount: 128, ratingAverage: 4.64));
    expect(find.byKey(const Key('vendor-details-rating')), findsOneWidget);
    expect(find.text('4.6'), findsOneWidget);
    expect(find.text('(128)'), findsOneWidget);
  });

  testWidgets('no ratings yet → no stars, no fake 0.0', (tester) async {
    await _pump(tester);
    expect(find.byKey(const Key('vendor-details-rating')), findsNothing);
    expect(find.text('0.0'), findsNothing);
  });

  testWidgets(
      'no overflow: 320px, Arabic, 2× text, with the "+" and the rating',
      (tester) async {
    await _pump(tester,
        details: _details(ratingCount: 128, ratingAverage: 4.6),
        width: 320,
        textScale: 2);
    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('product-quick-add-simple')), findsOneWidget);
  });
}
