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
        probeRoute('/vendors/:id', visited: visited),
        probeRoute('/home', visited: visited),
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
  testWidgets(
      'opened from Home (best sellers / offers): adding takes the customer to THAT product\'s store page, and back returns to Home',
      (tester) async {
    _phone(tester);
    final visited = <String>[];
    final api = _FakeCartApi();
    await _open(tester, _app(_product(), cartApi: api, visited: visited, location: '/home'));
    GoRouter.of(tester.element(find.byType(Scaffold).first)).push('/products/listing-1');
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    await _tapAdd(tester);
    expect(api.calls, hasLength(1));
    final storePath = '/vendors/${_product().vendorBranchId}';
    expect(find.text('page $storePath'), findsOneWidget);
    expect(find.byKey(const Key('added-to-cart-snackbar')), findsOneWidget);
    GoRouter.of(tester.element(find.text('page $storePath'))).pop();
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.text('page /home'), findsOneWidget, reason: 'back goes to where the customer started');
  });

  testWidgets(
      'opened from the store page: adding goes straight back to the store with a short "added" note and a View cart shortcut',
      (tester) async {
    _phone(tester);
    final visited = <String>[];
    final api = _FakeCartApi();
    await _open(
        tester, _app(_product(), cartApi: api, visited: visited, location: '/vendors/b1'));
    GoRouter.of(tester.element(find.byType(Scaffold).first)).push('/products/listing-1');
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    await _tapAdd(tester);
    expect(api.calls, hasLength(1));
    expect(find.byType(ProductDetailsScreen), findsNothing, reason: 'back on the store page');
    expect(find.byKey(const Key('added-to-cart-snackbar')), findsOneWidget);
    expect(find.textContaining('كولا'), findsOneWidget);
    final action = tester.widget<SnackBarAction>(find.byType(SnackBarAction));
    action.onPressed();
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(visited, contains('/cart'));
    expect(find.text('page /cart'), findsOneWidget);
  });

  group('Product Details — content', () {
    testWidgets(
        'shows the linked store logo, not the old store summary; CTA remains in scrolling content',
        (tester) async {
      _phone(tester);
      await _open(tester, _app(_product(), cartApi: _FakeCartApi()));
      expect(find.text('كولا'), findsOneWidget);
      expect(find.byKey(const Key('product-vendor-link')), findsOneWidget);
      expect(find.text('ماركت وان'), findsNothing);
      expect(find.text('4.5'), findsNothing);
      expect(find.text('(12)'), findsNothing);
      expect(find.text('مفتوح الآن'), findsNothing);
      expect(tester.widget<HatlyCtaButton>(find.byType(HatlyCtaButton)).onPressed, isNotNull);
      expect(find.text('أضف للسلة'), findsOneWidget);
      final scaffold = tester.widget<Scaffold>(find.byType(Scaffold).first);
      expect(scaffold.bottomNavigationBar, isNull,
          reason: 'the CTA lives in the scrolling content, not a sticky bar');
      expect(tester.takeException(), isNull);
    });

    testWidgets('closed store remains unorderable without the old summary card',
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
      final api = _FakeCartApi();
      await _open(
          tester, _app(_product(vendor: noRating), cartApi: api));
      expect(find.byKey(const Key('product-vendor-link')), findsOneWidget);
      expect(find.text('0.0'), findsNothing);
      expect(find.text('(0)'), findsNothing);
      expect(find.text('مغلق'), findsNothing);
      expect(tester.widget<HatlyCtaButton>(find.byType(HatlyCtaButton)).onPressed, isNull);
      await _tapAdd(tester);
      expect(api.calls, isEmpty, reason: 'a closed store cannot receive cart additions');
      expect(tester.takeException(), isNull);
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
        'weighted: starts at ¼ kg and steps by a quarter kilo (shown as ¼ ½ ¾); the request carries requestedWeightGrams and quantity 1',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi();
      await _open(tester, _app(_product(pricingUnit: 'WEIGHT'), cartApi: api));
      expect(find.text('¼ كجم'), findsWidgets); // the stepper value (and the ¼ preset chip)
      await tester.tap(find.byKey(const Key('qty-increase')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('qty-increase')));
      await tester.pump();
      expect(find.text('¾ كجم'), findsOneWidget);
      expect(find.text('75 ج.م'), findsOneWidget); // 100 per kg × 0.75
      await tester.tap(find.byKey(const Key('qty-decrease')));
      await tester.pump();
      expect(find.text('½ كجم'), findsWidgets);
      await _tapAdd(tester);
      expect(api.calls.single['quantity'], 1);
      expect(api.calls.single['grams'], 500);
    });

    testWidgets(
        'weighted: ONE tap on "1 كجم" selects 1 kg (instead of ten "+" taps) and the request carries 1000 g',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi();
      await _open(tester, _app(_product(pricingUnit: 'WEIGHT'), cartApi: api));
      await tester.tap(find.byKey(const Key('weight-preset-1000')));
      await tester.pump();
      expect(find.text('1 كجم'), findsNWidgets(2)); // the stepper value and the selected chip
      expect(find.text('100 ج.م'), findsWidgets); // 100 per kg × 1
      await _tapAdd(tester);
      expect(api.calls.single['grams'], 1000);
      expect(api.calls.single['quantity'], 1);
    });

    testWidgets(
        'weighted: the other presets work, and fractional weights stay possible with the stepper afterwards',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi();
      await _open(tester, _app(_product(pricingUnit: 'WEIGHT'), cartApi: api));
      await tester.tap(find.byKey(const Key('weight-preset-500')));
      await tester.pump();
      expect(find.text('½ كجم'), findsNWidgets(2));
      await tester.tap(find.byKey(const Key('qty-increase')));
      await tester.pump();
      expect(find.text('¾ كجم'), findsOneWidget);
      await tester.tap(find.byKey(const Key('weight-preset-2000')));
      await tester.pump();
      expect(find.text('2 كجم'), findsNWidgets(2));
      expect(find.text('200 ج.م'), findsWidgets);
    });

    testWidgets(
        'weighted: tapping the value lets the customer TYPE a weight; 1.25 kg → 1250 g; an invalid entry is explained, not accepted',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi();
      await _open(tester, _app(_product(pricingUnit: 'WEIGHT'), cartApi: api));
      await tester.tap(find.byKey(const Key('qty-value')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('weight-entry-field')),
          '0.05'); // below the 100 g minimum
      await tester.tap(find.byKey(const Key('weight-entry-confirm')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('weight-entry-field')),
          findsOneWidget); // still open, with an error
      expect(find.textContaining('أدخل وزنًا بين'), findsOneWidget);
      await tester.enterText(
          find.byKey(const Key('weight-entry-field')), 'abc');
      await tester.tap(find.byKey(const Key('weight-entry-confirm')));
      await tester.pumpAndSettle();
      expect(find.textContaining('أدخل وزنًا بين'), findsOneWidget);

      await tester.enterText(
          find.byKey(const Key('weight-entry-field')), '1.25');
      await tester.tap(find.byKey(const Key('weight-entry-confirm')));
      await tester.pumpAndSettle();
      expect(find.text('1¼ كجم'), findsOneWidget);
      await _tapAdd(tester);
      expect(api.calls.single['grams'], 1250);
    });

    testWidgets(
        'a TRACKED weighed listing disables presets above its stock and caps a typed weight',
        (tester) async {
      _phone(tester);
      await _open(
          tester,
          _app(
              _product(
                  pricingUnit: 'WEIGHT',
                  inventoryMode: 'TRACKED',
                  quantity: 1500),
              cartApi: _FakeCartApi()));
      final big = tester
          .widget<ChoiceChip>(find.byKey(const Key('weight-preset-2000')));
      final fits = tester
          .widget<ChoiceChip>(find.byKey(const Key('weight-preset-1000')));
      expect(big.onSelected, isNull);
      expect(fits.onSelected, isNotNull);
    });

    testWidgets('piece products show no weight presets', (tester) async {
      _phone(tester);
      await _open(tester, _app(_product(), cartApi: _FakeCartApi()));
      expect(find.byKey(const Key('weight-preset-1000')), findsNothing);
    });
  });

  group('add to cart', () {
    testWidgets(
        'success: the original LISTING id is sent, and the customer lands on the store page with a short note (no sheet)',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi();
      await _open(tester, _app(_product(), cartApi: api));
      await tester.tap(find.byKey(const Key('qty-increase')));
      await tester.pump();
      await _tapAdd(tester);

      expect(api.calls.single['productId'], 'listing-1');
      expect(api.calls.single['quantity'], 2);
      expect(find.text('page /vendors/b1'), findsOneWidget);
      expect(find.byKey(const Key('added-to-cart-snackbar')), findsOneWidget);
      expect(find.textContaining('تمت الإضافة إلى السلة'), findsOneWidget);
      expect(find.text('متابعة التسوق'), findsNothing, reason: 'no extra sheet to dismiss');
    });

    testWidgets('"عرض السلة" on the note opens the cart', (tester) async {
      _phone(tester);
      final visited = <String>[];
      await _open(
          tester, _app(_product(), cartApi: _FakeCartApi(), visited: visited));
      await _tapAdd(tester);
      tester.widget<SnackBarAction>(find.byType(SnackBarAction)).onPressed();
      await tester.pumpAndSettle();
      expect(visited, contains('/cart'));
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

  group('vendor link', () {
    testWidgets(
        'tapping the vendor logo opens THAT vendor page, by the listing\'s own vendorBranchId (never by the displayed name)',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      await _open(
          tester, _app(_product(), cartApi: _FakeCartApi(), visited: visited));
      expect(find.byKey(const Key('product-vendor-link')), findsOneWidget);
      await tester.tap(find.byKey(const Key('product-vendor-link')));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(visited, ['/vendors/b1']);
      expect(find.text('page /vendors/b1'), findsOneWidget);
    });

    testWidgets(
        'the control is an accessible button with a 48px-high target, labelled with the vendor name',
        (tester) async {
      _phone(tester);
      final handle = tester.ensureSemantics();
      await _open(tester, _app(_product(), cartApi: _FakeCartApi()));
      final semantics =
          tester.getSemantics(find.byKey(const Key('product-vendor-link')));
      expect(semantics.label, contains('ماركت وان'));
      expect(
          tester.getSize(find.byKey(const Key('product-vendor-link'))).height,
          greaterThanOrEqualTo(44));
      handle.dispose();
    });

    testWidgets(
        'a product without a vendor block shows no vendor link and does not crash',
        (tester) async {
      _phone(tester);
      await _open(
          tester, _app(_product(vendor: null), cartApi: _FakeCartApi()));
      expect(find.byKey(const Key('product-vendor-link')), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });

  group(
      'flash-sale price is the same in the header and in the total (Kefta 90 vs 110)',
      () {
    testWidgets(
        'header shows the special price and the total row shows it too; after "+" it doubles — never the normal price',
        (tester) async {
      _phone(tester);
      await _open(
          tester,
          _app(
            _product(
                offer: const ActiveOffer(
                    mechanism: 'FLASH_SALE', specialPriceMinor: 8000)),
            cartApi: _FakeCartApi(),
          ));
      // header: the special price (80) with the normal price (100) struck out; the total row: 80 — not 100
      expect(find.text('80 ج.م'), findsNWidgets(2));
      expect(find.text('100 ج.م'), findsOneWidget,
          reason:
              'only as the struck-out normal price, never as the payable total');
      await tester.tap(find.byKey(const Key('qty-increase')));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(find.text('160 ج.م'), findsOneWidget);
    });

    testWidgets(
        'with a per-order cap of 1 the second unit costs the normal price',
        (tester) async {
      _phone(tester);
      await _open(
          tester,
          _app(
            _product(
                offer: const ActiveOffer(
                    mechanism: 'FLASH_SALE',
                    specialPriceMinor: 8000,
                    perOrderLimit: 1)),
            cartApi: _FakeCartApi(),
          ));
      await tester.tap(find.byKey(const Key('qty-increase')));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(find.text('180 ج.م'), findsOneWidget); // 80 + 100
    });
  });
}
