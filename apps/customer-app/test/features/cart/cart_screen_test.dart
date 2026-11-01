import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/cart/data/cart_api.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';
import 'package:hatly_customer/features/cart/presentation/cart_screen.dart';
import 'package:hatly_customer/features/cart/presentation/widgets/cart_states.dart';
import 'package:hatly_customer/features/shell/presentation/shell_tab_provider.dart';
import 'package:hatly_customer/shared_widgets/hatly_soft_image.dart';

import '../../support/router_test_app.dart';

// ------------------------------------------------------------------ fakes

/// In-memory cart backend: applies the mutations the way the real API answers (returns the fresh cart; a
/// group disappears when its last item is removed — that decision is the fake BACKEND's, the app only renders).
class _FakeCartApi implements CartApi {
  _FakeCartApi(this.groups);

  List<CartGroup> groups;
  final calls = <String>[];
  Completer<Cart>? getCartGate;
  Completer<void>? mutationGate;
  int getCartCalls = 0;
  bool failNextGetCart = false;
  ApiException? failMutationWith;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  Cart _cart() => Cart(
        id: 'c',
        fulfillmentType: 'DELIVERY',
        groups: groups,
        subtotalMinor: groups.fold(0, (s, g) => s + (g.subtotalMinor ?? 0)),
        hasUnpricedItems: false,
        readyForCheckout: groups.isNotEmpty,
      );

  @override
  Future<Cart> getCart() async {
    getCartCalls++;
    if (failNextGetCart) {
      failNextGetCart = false;
      throw Exception('offline');
    }
    if (getCartGate != null) return getCartGate!.future;
    return _cart();
  }

  Future<Cart> _mutation(
      String label, CartItem Function(CartItem)? change, String itemId) async {
    calls.add(label);
    if (mutationGate != null) await mutationGate!.future;
    if (failMutationWith != null) throw failMutationWith!;
    groups = [
      for (final g in groups)
        if (change == null && g.items.every((i) => i.id == itemId))
          ...const <CartGroup>[] // last item of the group → the (fake) backend drops the group
        else
          _group(g, [
            for (final i in g.items)
              if (i.id != itemId) i else if (change != null) change(i)
          ]),
    ];
    return _cart();
  }

  @override
  Future<Cart> updateItemQuantity(
          {required String itemId, required int quantity}) =>
      _mutation('quantity:$itemId=$quantity',
          (i) => _copy(i, quantity: quantity), itemId);

  @override
  Future<Cart> updateItemWeight(
          {required String itemId, required int requestedWeightGrams}) =>
      _mutation('weight:$itemId=$requestedWeightGrams',
          (i) => _copy(i, grams: requestedWeightGrams), itemId);

  @override
  Future<Cart> removeItem(String itemId) =>
      _mutation('remove:$itemId', null, itemId);
}

CartGroup _group(CartGroup g, List<CartItem> items) => CartGroup(
      id: g.id,
      groupType: g.groupType,
      vendorBranchId: g.vendorBranchId,
      vendorName: g.vendorName,
      items: items,
      subtotalMinor: items.fold<int>(0, (s, i) => s + (i.lineTotalMinor ?? 0)),
      hasSubtotalDiscountOffer: g.hasSubtotalDiscountOffer,
    );

CartItem _copy(CartItem i, {int? quantity, int? grams}) => _item(
      id: i.id,
      productId: i.productId,
      name: i.productNameAr!,
      quantity: quantity ?? i.quantity,
      unitPrice: i.unitPriceMinor!,
      weighted: i.isWeighted,
      grams: grams ?? i.requestedWeightGrams,
      options: i.selectedOptionValues,
      imageUrl: i.productImageUrl,
    );

CartItem _item({
  required String id,
  String? productId,
  required String name,
  int quantity = 1,
  int unitPrice = 2600,
  bool weighted = false,
  int? grams,
  List<SelectedOptionValue> options = const [],
  String? imageUrl,
  bool flash = false,
  bool tracked = false,
  int? stock,
}) {
  final line = weighted
      ? ((unitPrice * (grams ?? 100)) / 1000).round()
      : unitPrice * quantity;
  return CartItem(
    id: id,
    productId: productId ?? 'prod-$id',
    productName: name,
    productNameAr: name,
    productImageUrl: imageUrl,
    quantity: weighted ? 1 : quantity,
    pricingUnit: weighted ? 'WEIGHT' : 'PIECE',
    requestedWeightGrams: weighted ? grams : null,
    inventoryMode: tracked ? 'TRACKED' : 'OPEN',
    availableQuantity: stock,
    selectedOptionValues: options,
    unitPriceMinor: unitPrice,
    lineTotalMinor: line,
    isAvailable: true,
    imageUrls: const [],
    offerId: flash ? 'o1' : null,
    offerMechanism: flash ? 'FLASH_SALE' : null,
    payableLineTotalMinor: flash ? line - 500 : line,
  );
}

CartGroup _vendor(String id, String name, List<CartItem> items,
        {bool discount = false, int? subtotal}) =>
    CartGroup(
      id: id,
      groupType: 'CATALOG',
      vendorBranchId: 'b-$id',
      vendorName: name,
      items: items,
      subtotalMinor:
          subtotal ?? items.fold<int>(0, (s, i) => s + (i.lineTotalMinor ?? 0)),
      hasSubtotalDiscountOffer: discount,
    );

const _opts = [
  SelectedOptionValue(
      id: 'l', name: 'Family', nameAr: 'عائلي', priceDeltaMinor: 500),
  SelectedOptionValue(
      id: 'ice', name: 'Ice', nameAr: 'ثلج', priceDeltaMinor: 0),
];

Widget _app(_FakeCartApi api,
        {List<String>? visited,
        bool dark = false,
        double textScale = 1.0,
        Locale locale = const Locale('ar')}) =>
    hatlyRouterApp(
      initialLocation: '/cart',
      dark: dark,
      textScale: textScale,
      locale: locale,
      overrides: [cartApiProvider.overrideWithValue(api)],
      routes: [
        GoRoute(path: '/cart', builder: (c, s) => const CartScreen()),
        probeRoute('/', visited: visited),
        probeRoute('/products/:id', visited: visited),
        probeRoute('/checkout', visited: visited),
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

Finder _plus(int index) => find.byKey(const Key('qty-increase')).at(index);
Finder _minus(int index) => find.byKey(const Key('qty-decrease')).at(index);

void main() {
  group('empty / loading / error', () {
    testWidgets(
        'empty cart: new visual, title and primary CTA (and no leftover totals)',
        (tester) async {
      _phone(tester);
      await _open(tester, _app(_FakeCartApi(const [])));
      expect(find.text('سلتك مستنيا طلبك'), findsOneWidget);
      expect(find.text('استكشف المنتجات'), findsOneWidget);
      expect(find.text('سلتك فارغة'), findsNothing);
      expect(find.text('متابعة لإتمام الطلب'), findsNothing);
      expect(find.byType(CartEmptyView), findsOneWidget);
    });

    testWidgets('the empty CTA goes back into discovery: shell Explore tab',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      await _open(tester, _app(_FakeCartApi(const []), visited: visited));
      await tester.tap(find.text('استكشف المنتجات'));
      await tester.pumpAndSettle();
      expect(visited, ['/']);
      final container =
          ProviderScope.containerOf(tester.element(find.text('page /')));
      expect(container.read(shellTabIndexProvider), ShellTab.search);
    });

    testWidgets('loading shows a cart-shaped skeleton, not a bare spinner',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi(const [])..getCartGate = Completer<Cart>();
      await tester.pumpWidget(_app(api));
      await tester.pump();
      expect(find.byType(CartSkeleton), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('error: worded message + retry that reloads the cart',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi([
        _vendor('g1', 'ماركت السلام', [_item(id: 'a', name: 'كولا')])
      ])
        ..failNextGetCart = true;
      await _open(tester, _app(api));
      expect(find.text('حدث خطأ ما'), findsOneWidget);
      expect(find.text('كولا'), findsNothing);
      await tester.tap(find.text('إعادة المحاولة'));
      await tester.pumpAndSettle();
      expect(api.getCartCalls, 2);
      expect(find.text('كولا'), findsOneWidget);
    });
  });

  group('vendor sections', () {
    testWidgets('a single vendor starts expanded', (tester) async {
      _phone(tester);
      await _open(
          tester,
          _app(_FakeCartApi([
            _vendor('g1', 'ماركت السلام', [_item(id: 'a', name: 'كولا')])
          ])));
      expect(find.text('ماركت السلام'), findsOneWidget);
      expect(find.text('كولا'), findsOneWidget);
    });

    testWidgets(
        'several vendors: only the FIRST starts expanded; any can be expanded/collapsed freely',
        (tester) async {
      _phone(tester);
      await _open(
          tester,
          _app(_FakeCartApi([
            _vendor('g1', 'ماركت السلام', [_item(id: 'a', name: 'كولا')]),
            _vendor('g2', 'صيدلية النور', [_item(id: 'b', name: 'فيتامين')]),
            _vendor('g3', 'مخبز الأمل', [_item(id: 'c', name: 'عيش')]),
          ])));
      expect(find.text('كولا'), findsOneWidget);
      expect(find.text('فيتامين'), findsNothing);
      expect(find.text('عيش'), findsNothing);
      // vendor names are always visible so the customer knows who is who
      for (final v in ['ماركت السلام', 'صيدلية النور', 'مخبز الأمل']) {
        expect(find.text(v), findsOneWidget);
      }

      await tester.tap(find.text('صيدلية النور'));
      await tester.pumpAndSettle();
      expect(find.text('فيتامين'), findsOneWidget);
      expect(find.text('كولا'), findsOneWidget,
          reason: 'expanding one does not collapse another');

      await tester.tap(find.text('ماركت السلام'));
      await tester.pumpAndSettle();
      expect(find.text('كولا'), findsNothing);
      await tester.tap(find.text('ماركت السلام'));
      await tester.pumpAndSettle();
      expect(find.text('كولا'), findsOneWidget);
    });

    testWidgets(
        'the header shows the API vendor subtotal (never recomputed) and the backend\'s discount flag',
        (tester) async {
      _phone(tester);
      // subtotal deliberately DIFFERENT from the sum of the lines: the app must show the API value
      await _open(
          tester,
          _app(_FakeCartApi([
            _vendor('g1', 'ماركت السلام', [_item(id: 'a', name: 'كولا')],
                subtotal: 12345, discount: true),
            _vendor('g2', 'صيدلية النور', [_item(id: 'b', name: 'فيتامين')]),
          ])));
      expect(find.text('123.45 ج.م'), findsOneWidget);
      expect(find.text('يوجد خصم على المنتجات المؤهلة من هذا المتجر'),
          findsOneWidget);
      // no grand total anywhere
      expect(find.text('الإجمالي'), findsNothing);
      expect(find.text('الإجمالي الفرعي'), findsNothing);
    });

    testWidgets(
        'a group with no subtotal (unpriced custom request) shows no invented 0',
        (tester) async {
      _phone(tester);
      const group = CartGroup(
        id: 'g1',
        groupType: 'CATALOG',
        vendorName: 'صيدلية النور',
        items: [
          CartItem(
              id: 'x',
              quantity: 1,
              freeTextDescription: 'علبة دواء',
              selectedOptionValues: [],
              isAvailable: true,
              imageUrls: [])
        ],
        subtotalMinor: null,
      );
      await _open(tester, _app(_FakeCartApi([group])));
      expect(find.text('0 ج.م'), findsNothing);
      expect(find.text('سيتم تأكيد السعر'), findsOneWidget);
      expect(find.text('طلب مخصص'), findsOneWidget);
    });
  });

  group('cart item row', () {
    testWidgets('renders the image from productImageUrl', (tester) async {
      _phone(tester);
      await _open(
          tester,
          _app(_FakeCartApi([
            _vendor('g1', 'ماركت السلام', [
              _item(
                  id: 'a', name: 'كولا', imageUrl: 'https://img.test/cola.png')
            ])
          ])));
      final image =
          tester.widget<HatlySoftImage>(find.byType(HatlySoftImage).first);
      expect(image.url, 'https://img.test/cola.png');
    });

    testWidgets('a missing image falls back to the soft placeholder',
        (tester) async {
      _phone(tester);
      await _open(
          tester,
          _app(_FakeCartApi([
            _vendor('g1', 'ماركت السلام', [_item(id: 'a', name: 'كولا')])
          ])));
      expect(find.byIcon(Icons.shopping_basket_outlined), findsOneWidget);
    });

    testWidgets(
        'selected options render; a product without options has no option line',
        (tester) async {
      _phone(tester);
      await _open(
          tester,
          _app(_FakeCartApi([
            _vendor('g1', 'ماركت السلام', [
              _item(id: 'a', name: 'كولا', options: _opts),
              _item(id: 'b', name: 'مياه'),
            ])
          ])));
      expect(find.text('عائلي، ثلج'), findsOneWidget);
      final withOptions = tester
          .getSize(find
              .ancestor(of: find.text('كولا'), matching: find.byType(Column))
              .first)
          .height;
      expect(find.text('مياه'), findsOneWidget);
      // the no-options row is shorter: no empty option line is reserved
      final plainRow = find
          .ancestor(of: find.text('مياه'), matching: find.byType(Column))
          .first;
      expect(tester.getSize(plainRow).height, lessThan(withOptions));
    });

    testWidgets(
        'flash sale: real indicator + struck original, payable price highlighted',
        (tester) async {
      _phone(tester);
      await _open(
          tester,
          _app(_FakeCartApi([
            _vendor('g1', 'ماركت السلام',
                [_item(id: 'a', name: 'كولا', flash: true)])
          ])));
      expect(find.text('عرض سريع'), findsOneWidget);
      expect(find.text('21 ج.م'), findsOneWidget); // 26 − 5 payable
      expect(find.text('26 ج.م'),
          findsWidgets); // original (line + vendor subtotal)
    });
  });

  group('quantity, weight, remove, edit', () {
    testWidgets(
        '+ and − call updateItemQuantity with the new quantity and the cart re-renders from the response',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi([
        _vendor(
            'g1', 'ماركت السلام', [_item(id: 'a', name: 'كولا', quantity: 2)])
      ]);
      await _open(tester, _app(api));
      await tester.tap(_plus(0));
      await tester.pumpAndSettle();
      expect(api.calls, ['quantity:a=3']);
      expect(find.text('3'), findsOneWidget);
      expect(find.text('78 ج.م'), findsWidgets); // 3 × 26, from the response
      await tester.tap(_minus(0));
      await tester.pumpAndSettle();
      expect(api.calls, ['quantity:a=3', 'quantity:a=2']);
    });

    testWidgets(
        'quantity − is disabled at 1 (no call), and the tracked-stock cap disables +',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi([
        _vendor('g1', 'ماركت السلام', [
          _item(id: 'a', name: 'كولا', quantity: 1),
          _item(id: 'b', name: 'مياه', quantity: 3, tracked: true, stock: 3),
        ])
      ]);
      await _open(tester, _app(api));
      await tester.tap(_minus(0));
      await tester.tap(_plus(1));
      await tester.pumpAndSettle();
      expect(api.calls, isEmpty);
    });

    testWidgets(
        'weighted lines step by 100g through updateItemWeight (never updateItemQuantity)',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi([
        _vendor('g1', 'ماركت السلام', [
          _item(
              id: 'w',
              name: 'طماطم',
              weighted: true,
              grams: 300,
              unitPrice: 2800)
        ])
      ]);
      await _open(tester, _app(api));
      expect(find.text('0.30 kg'), findsOneWidget);
      await tester.tap(_plus(0));
      await tester.pumpAndSettle();
      expect(api.calls, ['weight:w=400']);
      expect(find.text('0.40 kg'), findsOneWidget);
      await tester.tap(_minus(0));
      await tester.pumpAndSettle();
      expect(api.calls, ['weight:w=400', 'weight:w=300']);
      // floor at 100g
      await tester.tap(_minus(0));
      await tester.pumpAndSettle();
      await tester.tap(_minus(0));
      await tester.pumpAndSettle();
      expect(api.calls.last, 'weight:w=100');
      await tester.tap(_minus(0));
      await tester.pumpAndSettle();
      expect(api.calls.length, 4, reason: 'no call below 100g');
    });

    testWidgets(
        'weighted lines: tap the value, type 1 kg → ONE updateItemWeight call with 1000 g (not ten "+" taps); an invalid entry sends nothing',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi([
        _vendor('g1', 'ماركت السلام', [
          _item(
              id: 'w',
              name: 'طماطم',
              weighted: true,
              grams: 300,
              unitPrice: 2800)
        ])
      ]);
      await _open(tester, _app(api));
      await tester.tap(find.byKey(const Key('qty-value')));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.byKey(const Key('weight-entry-field')), '0.01');
      await tester.tap(find.byKey(const Key('weight-entry-confirm')));
      await tester.pumpAndSettle();
      expect(api.calls, isEmpty,
          reason: 'below the minimum: refused in the dialog');
      await tester.enterText(find.byKey(const Key('weight-entry-field')), '1');
      await tester.tap(find.byKey(const Key('weight-entry-confirm')));
      await tester.pumpAndSettle();
      expect(api.calls, ['weight:w=1000']);
      expect(find.text('1.00 kg'), findsOneWidget);
    });

    testWidgets(
        'while a line is updating its controls are disabled (no duplicate taps) but the rest of the cart works',
        (tester) async {
      _phone(tester);
      final gate = Completer<void>();
      final api = _FakeCartApi([
        _vendor('g1', 'ماركت السلام', [
          _item(id: 'a', name: 'كولا', quantity: 2),
          _item(id: 'b', name: 'مياه', quantity: 2),
        ])
      ])
        ..mutationGate = gate;
      await _open(tester, _app(api));
      await tester.tap(_plus(0));
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      await tester.tap(_plus(0));
      await tester.tap(_plus(0));
      await tester.pump();
      expect(api.calls, ['quantity:a=3'],
          reason: 'taps during the update are ignored');
      // another line is still usable
      await tester.tap(_plus(1));
      await tester.pump();
      expect(api.calls, ['quantity:a=3', 'quantity:b=3']);
      gate.complete();
      await tester.pumpAndSettle();
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets(
        'a rejected mutation shows the backend reason and keeps the line',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi([
        _vendor('g1', 'ماركت السلام', [_item(id: 'a', name: 'كولا')])
      ])
        ..failMutationWith = const ApiException(
            code: 'BAD_REQUEST',
            message: 'x',
            details: {'code': 'PRODUCT_UNAVAILABLE'});
      await _open(tester, _app(api));
      await tester.tap(_plus(0));
      await tester.pumpAndSettle();
      expect(find.text('هذا المنتج غير متوفر حاليًا'), findsOneWidget);
      expect(find.text('كولا'), findsOneWidget);
    });

    testWidgets(
        'remove is a labelled action that calls removeItem; the line disappears',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi([
        _vendor('g1', 'ماركت السلام', [
          _item(id: 'a', name: 'كولا'),
          _item(id: 'b', name: 'مياه'),
        ])
      ]);
      await _open(tester, _app(api));
      final remove = find.byTooltip('حذف المنتج').first;
      expect(remove, findsOneWidget);
      await tester.tap(remove);
      await tester.pumpAndSettle();
      expect(api.calls, ['remove:a']);
      expect(find.text('كولا'), findsNothing);
      expect(find.text('مياه'), findsOneWidget);
    });

    testWidgets(
        'removing the LAST item of a vendor lets the backend response decide: the group disappears',
        (tester) async {
      _phone(tester);
      final api = _FakeCartApi([
        _vendor('g1', 'ماركت السلام', [_item(id: 'a', name: 'كولا')]),
        _vendor('g2', 'صيدلية النور', [_item(id: 'b', name: 'فيتامين')]),
      ]);
      await _open(tester, _app(api));
      await tester.tap(find.byTooltip('حذف المنتج'));
      await tester.pumpAndSettle();
      expect(find.text('ماركت السلام'), findsNothing);
      // the remaining vendor becomes the first section → expanded by the same rule
      expect(find.text('صيدلية النور'), findsOneWidget);
      expect(find.text('فيتامين'), findsOneWidget);

      // and removing the very last item leaves the empty state
      await tester.tap(find.byTooltip('حذف المنتج'));
      await tester.pumpAndSettle();
      expect(find.byType(CartEmptyView), findsOneWidget);
    });

    testWidgets(
        '"تعديل" opens Product Details with the cart line\'s productId (no mutation, nothing removed)',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      final api = _FakeCartApi([
        _vendor('g1', 'ماركت السلام', [
          _item(id: 'a', productId: 'listing-77', name: 'كولا', options: _opts)
        ])
      ]);
      await _open(tester, _app(api, visited: visited));
      expect(find.textContaining('احذف السطر القديم'), findsOneWidget,
          reason:
              'the "edit = add again, then remove the old line" flow is explained');
      await tester.tap(find.text('تعديل'));
      await tester.pumpAndSettle();
      expect(visited, ['/products/listing-77']);
      expect(api.calls, isEmpty);
    });

    testWidgets(
        'checkout entry keeps working (enabled when the backend says ready) and shows no amount',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      await _open(
          tester,
          _app(
              _FakeCartApi([
                _vendor('g1', 'ماركت السلام', [_item(id: 'a', name: 'كولا')])
              ]),
              visited: visited));
      await tester.tap(find.text('متابعة لإتمام الطلب'));
      await tester.pumpAndSettle();
      expect(visited, ['/checkout']);
    });
  });

  group('themes, RTL, accessibility, small screens', () {
    _FakeCartApi cart() => _FakeCartApi([
          _vendor(
              'g1',
              'ماركت السلام مع اسم طويل جدًا للتجربة',
              [
                _item(
                    id: 'a',
                    name: 'كولا عائلية بحجم كبير جدًا',
                    options: _opts,
                    flash: true,
                    quantity: 12),
                _item(
                    id: 'w',
                    name: 'طماطم',
                    weighted: true,
                    grams: 1500,
                    unitPrice: 2800),
              ],
              discount: true),
          _vendor('g2', 'صيدلية النور', [_item(id: 'b', name: 'فيتامين')]),
        ]);

    for (final s in const [
      ('ar light 390', Locale('ar'), false, 390.0, 1.0),
      ('en light 390', Locale('en'), false, 390.0, 1.0),
      ('ar dark 390', Locale('ar'), true, 390.0, 1.0),
      ('en dark 390', Locale('en'), true, 390.0, 1.0),
      ('ar dark 320 large text', Locale('ar'), true, 320.0, 1.6),
      ('ar light 320 2x text', Locale('ar'), false, 320.0, 2.0),
    ]) {
      testWidgets('cart renders without overflow: ${s.$1}', (tester) async {
        _phone(tester, width: s.$4, height: 3000);
        await _open(
            tester, _app(cart(), locale: s.$2, dark: s.$3, textScale: s.$5));
        expect(tester.takeException(), isNull);
        await tester.tap(
            find.text('صيدلية النور').evaluate().isNotEmpty
                ? find.text('صيدلية النور')
                : find.text('Pharmacy'),
            warnIfMissed: false);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final bg = Theme.of(tester.element(find.byType(CartScreen)))
            .scaffoldBackgroundColor;
        expect(bg.computeLuminance() < 0.1, s.$3);
      });

      testWidgets('empty / skeleton / error render: ${s.$1}', (tester) async {
        _phone(tester, width: s.$4);
        await _open(
            tester,
            _app(_FakeCartApi(const []),
                locale: s.$2, dark: s.$3, textScale: s.$5));
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        final gated = _FakeCartApi(const [])..getCartGate = Completer<Cart>();
        await tester
            .pumpWidget(_app(gated, locale: s.$2, dark: s.$3, textScale: s.$5));
        await tester.pump();
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        await _open(
            tester,
            _app(_FakeCartApi(const [])..failNextGetCart = true,
                locale: s.$2, dark: s.$3, textScale: s.$5));
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets(
        'semantics: remove, expand/collapse and quantity are labelled; touch targets ≥ 44px',
        (tester) async {
      _phone(tester);
      final handle = tester.ensureSemantics();
      await _open(
          tester,
          _app(_FakeCartApi([
            _vendor('g1', 'ماركت السلام', [_item(id: 'a', name: 'كولا')]),
            _vendor('g2', 'صيدلية النور', [_item(id: 'b', name: 'فيتامين')]),
          ])));
      expect(find.bySemanticsLabel('حذف المنتج'), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp('^إخفاء منتجات ماركت السلام')),
          findsOneWidget);
      expect(find.bySemanticsLabel(RegExp('^عرض منتجات صيدلية النور')),
          findsOneWidget);
      expect(find.bySemanticsLabel('زيادة الكمية'), findsOneWidget);
      expect(find.bySemanticsLabel('تقليل الكمية'), findsOneWidget);
      for (final f in [_plus(0), _minus(0), find.byTooltip('حذف المنتج')]) {
        final size = tester.getSize(f);
        expect(size.height, greaterThanOrEqualTo(44));
        expect(size.width, greaterThanOrEqualTo(44));
      }
      handle.dispose();
    });
  });
}
