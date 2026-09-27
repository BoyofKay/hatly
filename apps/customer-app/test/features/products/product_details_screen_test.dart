import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/cart/data/cart_api.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';
import 'package:hatly_customer/features/products/data/product_providers.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/features/products/domain/product_option.dart';
import 'package:hatly_customer/features/products/presentation/product_details_screen.dart';
import 'package:hatly_customer/shared_widgets/hatly_cta_button.dart';

import '../../support/router_test_app.dart';

/// Records every add-to-cart call and returns a cart with the item; can be told to fail with a backend
/// business code.
class _FakeCartApi implements CartApi {
  _FakeCartApi({this.failWith});

  final String? failWith;
  final calls = <Map<String, Object?>>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<Cart> getCart() async => _cart(0);

  @override
  Future<Cart> addItem({
    required String productId,
    required int quantity,
    List<String>? selectedOptionValueIds,
    String? notes,
    int? requestedWeightGrams,
  }) async {
    calls.add({
      'productId': productId,
      'quantity': quantity,
      'options': selectedOptionValueIds,
      'grams': requestedWeightGrams,
    });
    if (failWith != null) {
      throw ApiException(
          code: 'CONFLICT',
          message: 'nope',
          details: {'code': failWith},
          statusCode: 409);
    }
    return _cart(quantity);
  }

  Cart _cart(int qty) => Cart(
        id: 'c',
        fulfillmentType: 'DELIVERY',
        groups: qty == 0
            ? const []
            : [
                CartGroup(
                  id: 'g',
                  groupType: 'CATALOG',
                  vendorBranchId: 'b1',
                  vendorName: 'Market One',
                  items: [
                    CartItem(
                        id: 'i',
                        productId: 'listing-1',
                        quantity: qty,
                        selectedOptionValues: const [],
                        isAvailable: true,
                        imageUrls: const [])
                  ],
                  subtotalMinor: 30000,
                )
              ],
        subtotalMinor: qty == 0 ? 0 : 30000,
        hasUnpricedItems: false,
        readyForCheckout: qty != 0,
      );
}

const _vendor = ProductVendorSummary(
  id: 'v1',
  vendorBranchId: 'b1',
  name: 'Market One',
  nameAr: 'ماركت وان',
  branchName: 'Market One Main',
  isOpen: true,
  ratingAverage: 4.5,
  ratingCount: 12,
);

Product _product({
  String id = 'listing-1',
  String? catalogId,
  ProductVendorSummary? vendor = _vendor,
  List<ProductOption> options = const [],
  String pricingUnit = 'PIECE',
  String inventoryMode = 'OPEN',
  int? quantity,
  String? description,
  ActiveOffer? offer,
}) =>
    Product(
      id: id,
      vendorBranchId: 'b1',
      categoryId: 'c',
      name: 'Cola',
      nameAr: 'كولا',
      description: description,
      descriptionAr: description,
      priceMinor: 10000,
      isAvailable: true,
      pricingUnit: pricingUnit,
      inventoryMode: inventoryMode,
      quantity: quantity,
      options: options,
      activeOffer: offer,
      catalogProductId: catalogId,
      vendor: vendor,
    );

const _size = ProductOption(
  id: 'size',
  name: 'Size',
  nameAr: 'الحجم',
  isRequired: true,
  allowsMultiple: false,
  values: [
    ProductOptionValue(id: 'size-s', name: 'Small', nameAr: 'صغير'),
    ProductOptionValue(
        id: 'size-l', name: 'Large', nameAr: 'كبير', priceDeltaMinor: 2000),
  ],
);
const _extras = ProductOption(
  id: 'extras',
  name: 'Extras',
  nameAr: 'إضافات',
  isRequired: true,
  allowsMultiple: true,
  values: [
    ProductOptionValue(
        id: 'extras-ice', name: 'Ice', nameAr: 'ثلج', priceDeltaMinor: 500),
    ProductOptionValue(id: 'extras-lemon', name: 'Lemon', nameAr: 'ليمون'),
  ],
);
const _sauce = ProductOption(
  id: 'sauce',
  name: 'Sauce',
  nameAr: 'صوص',
  isRequired: false,
  allowsMultiple: true,
  values: [ProductOptionValue(id: 'sauce-a', name: 'A', nameAr: 'أ')],
);

Widget _app(
  Product product, {
  required _FakeCartApi cartApi,
  List<String>? visited,
  String location = '/products/listing-1',
  bool dark = false,
  double textScale = 1.0,
  Locale locale = const Locale('ar'),
}) =>
    hatlyRouterApp(
      initialLocation: location,
      dark: dark,
      textScale: textScale,
      locale: locale,
      overrides: [
        productDetailsProvider.overrideWith((ref, id) async => product),
        cartApiProvider.overrideWithValue(cartApi),
      ],
      routes: [
        GoRoute(
          path: '/products/:id',
          builder: (context, state) => ProductDetailsScreen(
            productId: state.pathParameters['id']!,
            fromCatalog: state.uri.queryParameters['from'] == 'catalog',
          ),
        ),
        probeRoute('/cart', visited: visited),
        probeRoute('/catalog-products/:id', visited: visited),
      ],
    );

void _phone(WidgetTester tester, {double width = 390, double height = 2400}) {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> _open(WidgetTester tester, Widget app) async {
  await tester.pumpWidget(app);
  await tester.pumpAndSettle(const Duration(milliseconds: 100));
}

Future<void> _tapAdd(WidgetTester tester) async {
  await tester.ensureVisible(find.byType(HatlyCtaButton));
  await tester.tap(find.byType(HatlyCtaButton));
  await tester.pumpAndSettle(const Duration(milliseconds: 100));
}

void main() {
  group('Product Details — content', () {
    testWidgets(
        'shows the selling store: name, real rating + count, open state; CTA is in the content (not sticky)',
        (tester) async {
      _phone(tester);
      await _open(tester, _app(_product(), cartApi: _FakeCartApi()));
      expect(find.text('كولا'), findsOneWidget);
      expect(find.text('ماركت وان'), findsOneWidget);
      expect(find.text('4.5'), findsOneWidget);
      expect(find.text('(12)'), findsOneWidget);
      expect(find.text('مفتوح الآن'), findsOneWidget);
      expect(find.text('أضف للسلة'), findsOneWidget);
      final scaffold = tester.widget<Scaffold>(find.byType(Scaffold).first);
      expect(scaffold.bottomNavigationBar, isNull,
          reason: 'the CTA lives in the scrolling content, not a sticky bar');
      expect(tester.takeException(), isNull);
    });

    testWidgets('no rating is invented for a store without ratings',
        (tester) async {
      _phone(tester);
      const noRating = ProductVendorSummary(
          id: 'v',
          vendorBranchId: 'b',
          name: 'New Store',
          branchName: 'Main',
          isOpen: false,
          ratingAverage: 0,
          ratingCount: 0);
      await _open(
          tester, _app(_product(vendor: noRating), cartApi: _FakeCartApi()));
      expect(find.text('0.0'), findsNothing);
      expect(find.text('(0)'), findsNothing);
      expect(find.text('مغلق'), findsOneWidget);
    });

    testWidgets(
        '"تغيير المتجر" only for a marketplace (catalog) product; unlinked products do not show it',
        (tester) async {
      _phone(tester);
      await _open(
          tester, _app(_product(catalogId: 'cat-1'), cartApi: _FakeCartApi()));
      expect(find.text('تغيير المتجر'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await _open(tester, _app(_product(), cartApi: _FakeCartApi()));
      expect(find.text('تغيير المتجر'), findsNothing);
    });

    testWidgets(
        '"تغيير المتجر" returns to the store selector: pop when it is below us, otherwise open it',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      // arrived directly (e.g. from Home) → opens the catalog selector
      await _open(
          tester,
          _app(_product(catalogId: 'cat-1'),
              cartApi: _FakeCartApi(), visited: visited));
      await tester.tap(find.text('تغيير المتجر'));
      await tester.pumpAndSettle();
      expect(visited, ['/catalog-products/cat-1']);
    });

    testWidgets(
        'a long description starts collapsed with "عرض المزيد" and expands in place; short text has no control',
        (tester) async {
      _phone(tester);
      final long = List.filled(40, 'مشروب غازي بارد ومنعش').join(' ');
      await _open(
          tester, _app(_product(description: long), cartApi: _FakeCartApi()));
      expect(find.text('عرض المزيد'), findsOneWidget);
      expect(find.text('عرض أقل'), findsNothing);
      final collapsed = tester.getSize(find.text(long)).height;
      await tester.tap(find.text('عرض المزيد'));
      await tester.pumpAndSettle();
      expect(find.text('عرض أقل'), findsOneWidget);
      expect(tester.getSize(find.text(long)).height, greaterThan(collapsed));
      await tester.tap(find.text('عرض أقل'));
      await tester.pumpAndSettle();
      expect(find.text('عرض المزيد'), findsOneWidget);

      await tester.pumpWidget(const SizedBox());
      await _open(
          tester, _app(_product(description: 'قصير'), cartApi: _FakeCartApi()));
      expect(find.text('عرض المزيد'), findsNothing);
    });
  });

  group('configuration + quantity', () {
    testWidgets(
        'quantity [ − 1 + ]: changes the total, never below 1, capped by tracked stock',
        (tester) async {
      _phone(tester);
      await _open(
          tester,
          _app(_product(inventoryMode: 'TRACKED', quantity: 3),
              cartApi: _FakeCartApi()));
      expect(find.text('100 ج.م'), findsWidgets); // price and total
      await tester.tap(find.byKey(const Key('qty-increase')));
      await tester.pump();
      expect(find.text('2'), findsOneWidget);
      expect(find.text('200 ج.م'), findsOneWidget);
      await tester.tap(find.byKey(const Key('qty-increase')));
      await tester.pump();
      expect(find.text('300 ج.م'), findsOneWidget);
      // 3 = known stock → "+" is disabled
      await tester.tap(find.byKey(const Key('qty-increase')));
      await tester.pump();
      expect(find.text('3'), findsOneWidget);
      await tester.tap(find.byKey(const Key('qty-decrease')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('qty-decrease')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('qty-decrease')));
      await tester.pump();
      expect(find.text('1'), findsOneWidget);
      // and the control is comfortably tappable
      expect(tester.getSize(find.byKey(const Key('qty-increase'))).height,
          greaterThanOrEqualTo(44));
    });

    testWidgets(
        'a required single-select is preselected (first value) and its price delta moves the total',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi();
      await _open(tester, _app(_product(options: [_size]), cartApi: api));
      expect(find.text('الحجم'), findsOneWidget);
      expect(find.text('مطلوب'), findsOneWidget);
      await _tapAdd(tester);
      expect(api.calls.single['options'], ['size-s']);

      await tester.pumpWidget(const SizedBox());
      final api2 = _FakeCartApi();
      await _open(tester, _app(_product(options: [_size]), cartApi: api2));
      await tester.tap(find.text('كبير'));
      await tester.pump();
      expect(find.text('120 ج.م'), findsOneWidget); // 100 + 20 delta, total row
      await _tapAdd(tester);
      expect(api2.calls.single['options'], ['size-l']);
    });

    testWidgets(
        'a required multi-select blocks the add with a WORDED message until a value is chosen',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi();
      await _open(tester, _app(_product(options: [_extras]), cartApi: api));
      expect(find.text('اختر خيارًا واحدًا على الأقل'), findsNothing);
      await _tapAdd(tester);
      expect(api.calls, isEmpty,
          reason: 'no request until the required option is satisfied');
      expect(find.text('اختر خيارًا واحدًا على الأقل'), findsOneWidget);
      expect(find.text('تمت الإضافة إلى السلة'), findsNothing);

      await tester.tap(find.text('ثلج'));
      await tester.pump();
      expect(find.text('اختر خيارًا واحدًا على الأقل'), findsNothing);
      await _tapAdd(tester);
      expect(api.calls.single['options'], ['extras-ice']);
    });

    testWidgets('optional options never block the add', (tester) async {
      _phone(tester);
      final api = _FakeCartApi();
      await _open(tester, _app(_product(options: [_sauce]), cartApi: api));
      expect(find.text('مطلوب'), findsNothing);
      await _tapAdd(tester);
      expect(api.calls, hasLength(1));
      expect(api.calls.single['options'], isEmpty);
    });

    testWidgets(
        'weighted: 100g steps shown in kg; the request carries requestedWeightGrams and quantity 1',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi();
      await _open(tester, _app(_product(pricingUnit: 'WEIGHT'), cartApi: api));
      expect(find.text('0.10 kg'), findsOneWidget);
      await tester.tap(find.byKey(const Key('qty-increase')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('qty-increase')));
      await tester.pump();
      expect(find.text('0.30 kg'), findsOneWidget);
      expect(find.text('30 ج.م'), findsOneWidget); // 100 per kg × 0.3
      await tester.tap(find.byKey(const Key('qty-decrease')));
      await tester.pump();
      expect(find.text('0.20 kg'), findsOneWidget);
      await _tapAdd(tester);
      expect(api.calls.single['quantity'], 1);
      expect(api.calls.single['grams'], 200);
    });
  });

  group('add to cart', () {
    testWidgets(
        'success: the original LISTING id is sent, and a Cart Mini-Sheet appears (no SnackBar-only)',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi();
      await _open(tester, _app(_product(), cartApi: api));
      await tester.tap(find.byKey(const Key('qty-increase')));
      await tester.pump();
      await _tapAdd(tester);

      expect(api.calls.single['productId'], 'listing-1');
      expect(api.calls.single['quantity'], 2);
      expect(find.text('تمت الإضافة إلى السلة'), findsOneWidget);
      // sheet contents: item, quantity, vendor, total, cart summary, both actions
      expect(find.text('×2'), findsOneWidget);
      expect(find.text('من ماركت وان'), findsOneWidget);
      expect(find.text('عرض السلة'), findsOneWidget);
      expect(find.text('متابعة التسوق'), findsOneWidget);
      expect(find.textContaining('السلة:'), findsOneWidget);
      expect(find.byType(SnackBar), findsNothing);
      // not checkout: no payment / address / order placement anywhere in the sheet
      expect(find.textContaining('الدفع'), findsNothing);
      expect(find.textContaining('العنوان'), findsNothing);
    });

    testWidgets('"متابعة التسوق" dismisses the sheet and stays on the product',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      await _open(
          tester, _app(_product(), cartApi: _FakeCartApi(), visited: visited));
      await _tapAdd(tester);
      await tester.tap(find.text('متابعة التسوق'));
      await tester.pumpAndSettle();
      expect(find.text('تمت الإضافة إلى السلة'), findsNothing);
      expect(find.byType(HatlyCtaButton), findsOneWidget);
      expect(visited, isEmpty);
    });

    testWidgets('"عرض السلة" dismisses the sheet and opens the cart',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      await _open(
          tester, _app(_product(), cartApi: _FakeCartApi(), visited: visited));
      await _tapAdd(tester);
      await tester.tap(find.text('عرض السلة'));
      await tester.pumpAndSettle();
      expect(visited, ['/cart']);
      expect(find.text('page /cart'), findsOneWidget);
    });

    testWidgets(
        'failure: the backend\'s reason is shown (multi-vendor cap), no sheet, no cart change',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi(failWith: 'MAX_VENDOR_GROUPS_EXCEEDED');
      await _open(tester, _app(_product(), cartApi: api));
      await _tapAdd(tester);
      expect(api.calls, hasLength(1));
      expect(find.text('تمت الإضافة إلى السلة'), findsNothing);
      expect(find.text('وصلت إلى الحد الأقصى لعدد المتاجر في السلة الواحدة'),
          findsOneWidget);
      // the button is usable again
      expect(
          tester.widget<HatlyCtaButton>(find.byType(HatlyCtaButton)).isLoading,
          isFalse);
    });

    testWidgets(
        'other real cart rules have their own messages (pickup single-vendor, unavailable product)',
        (tester) async {
      _phone(tester);
      for (final entry in {
        'PICKUP_SINGLE_VENDOR_ONLY':
            'الاستلام من المتجر متاح لمتجر واحد فقط. غيّر إلى التوصيل لإضافة متجر آخر.',
        'PRODUCT_UNAVAILABLE': 'هذا المنتج غير متوفر حاليًا',
      }.entries) {
        await tester.pumpWidget(const SizedBox());
        await _open(tester,
            _app(_product(), cartApi: _FakeCartApi(failWith: entry.key)));
        await _tapAdd(tester);
        expect(find.text(entry.value), findsOneWidget, reason: entry.key);
      }
    });
  });

  group('themes / accessibility / small screens', () {
    for (final s in const [
      ('ar light 390', Locale('ar'), false, 390.0, 1.0),
      ('en dark 390', Locale('en'), true, 390.0, 1.0),
      ('ar dark 320 large text', Locale('ar'), true, 320.0, 1.6),
      ('ar light 320 2x text', Locale('ar'), false, 320.0, 2.0),
    ]) {
      testWidgets('no overflow with options, offer and vendor: ${s.$1}',
          (tester) async {
        _phone(tester, width: s.$4, height: 3200);
        await _open(
            tester,
            _app(
              _product(
                catalogId: 'cat-1',
                options: [_size, _extras, _sauce],
                description: List.filled(30, 'وصف طويل للمنتج').join(' '),
                offer: const ActiveOffer(
                    mechanism: 'FLASH_SALE', specialPriceMinor: 8000),
              ),
              cartApi: _FakeCartApi(),
              locale: s.$2,
              dark: s.$3,
              textScale: s.$5,
            ));
        expect(tester.takeException(), isNull);
        await _tapAdd(
            tester); // required multi-select empty → error text renders too
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets(
        'icon buttons carry semantic labels and the CTA is a labelled button',
        (tester) async {
      _phone(tester);
      final handle = tester.ensureSemantics();
      await _open(tester, _app(_product(), cartApi: _FakeCartApi()));
      expect(find.bySemanticsLabel('زيادة الكمية'), findsOneWidget);
      expect(find.bySemanticsLabel('تقليل الكمية'), findsOneWidget);
      expect(find.bySemanticsLabel('أضف للسلة'), findsOneWidget);
      handle.dispose();
    });
  });
}
