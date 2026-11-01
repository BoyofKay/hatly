import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/products/domain/product_option.dart';
import 'package:hatly_customer/features/products/presentation/widgets/product_option_group.dart';

import '../../support/test_app.dart';

ProductOption _group(
        {int min = 0,
        int? max,
        bool required = false,
        bool multiple = true,
        List<ProductOptionValue>? values}) =>
    ProductOption(
      id: 'g',
      name: 'Toppings',
      nameAr: 'إضافات',
      isRequired: required,
      allowsMultiple: multiple,
      minSelections: min,
      maxSelections: max,
      values: values ??
          const [
            ProductOptionValue(
                id: 'a', name: 'Olives', nameAr: 'زيتون', priceDeltaMinor: 500),
            ProductOptionValue(
                id: 'b', name: 'Cheese', nameAr: 'جبنة', priceDeltaMinor: -200),
            ProductOptionValue(id: 'c', name: 'Mushrooms', nameAr: 'مشروم'),
          ],
    );

Future<void> _pump(
    WidgetTester tester, ProductOption option, Set<String> selected,
    {bool showError = false, Locale locale = const Locale('ar')}) async {
  await tester.pumpWidget(hatlyTestApp(
    Scaffold(
        body: SingleChildScrollView(
            child: ProductOptionGroup(
                option: option,
                selected: selected,
                onToggle: (_) {},
                showError: showError))),
    locale: locale,
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('limits are explained in words only where they add information',
      (tester) async {
    await _pump(tester, _group(min: 2, max: 4), {});
    expect(find.text('اختر من 2 إلى 4'), findsOneWidget);
    await _pump(tester, _group(max: 3), {});
    expect(find.text('اختر حتى 3'), findsOneWidget);
    await _pump(tester, _group(min: 2), {});
    expect(find.text('اختر 2 على الأقل'), findsOneWidget);
    // plain optional multiple / single-choice / plain required: nothing extra to say
    await _pump(tester, _group(), {});
    expect(find.byKey(const Key('option-limits-g')), findsNothing);
    await _pump(tester, _group(multiple: false, required: true), {});
    expect(find.byKey(const Key('option-limits-g')), findsNothing);
  });

  testWidgets('English wording', (tester) async {
    await _pump(tester, _group(min: 1, max: 3, required: true), {},
        locale: const Locale('en'));
    expect(find.text('Choose 1 to 3'), findsOneWidget);
  });

  testWidgets(
      'a negative modifier reads "-2 EGP", never "+-2" (on screen and for screen readers)',
      (tester) async {
    await _pump(tester, _group(), {}, locale: const Locale('en'));
    expect(find.text('+5 EGP'), findsOneWidget);
    expect(find.text('-2 EGP'), findsOneWidget);
    expect(find.textContaining('+-'), findsNothing);
    final handle = tester.ensureSemantics();
    expect(tester.getSemantics(find.text('Cheese')).label, contains('-2 EGP'));
    expect(
        tester.getSemantics(find.text('Cheese')).label, isNot(contains('+-')));
    handle.dispose();
  });

  testWidgets(
      'below the minimum says so once an error is being shown; nothing chosen at all keeps the required message',
      (tester) async {
    await _pump(tester, _group(min: 2, required: true), {'a'}, showError: true);
    expect(find.byKey(const Key('option-min-error-g')), findsOneWidget);
    expect(find.text('اختر 2 على الأقل'), findsWidgets);
    await _pump(tester, _group(min: 2, required: true), {}, showError: true);
    expect(find.byKey(const Key('option-min-error-g')), findsNothing);
  });

  testWidgets(
      'at the maximum the unchosen values are dimmed and announced as unavailable',
      (tester) async {
    await _pump(tester, _group(max: 2), {'a', 'b'});
    final dimmed = tester
        .widgetList<Opacity>(find.byType(Opacity))
        .where((o) => o.opacity < 1)
        .length;
    expect(dimmed, 1, reason: 'only the one unchosen value');
  });
}
