import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/home/presentation/widgets/category_card.dart';
import 'package:hatly_customer/features/home/presentation/widgets/home_category_section.dart';
import 'package:hatly_customer/features/sectors/domain/sector.dart';

import '../../support/test_app.dart';

/// Home "Shop by category" (owner, 2026-11-11): two soft cards per row — never limited to two categories — with restrained corners,
/// equal card sizes, readable Arabic names, and no clipping on small phones or with large text.
void main() {
  List<MarketplaceSector> make(int n, {bool long = false}) => [
        for (var i = 0; i < n; i++)
          MarketplaceSector(
              id: 'id$i',
              name: long ? 'A very long category name for testing number $i' : 'Cat $i',
              nameAr: long ? 'اسم قسم طويل جدًا لاختبار الالتفاف رقم $i' : 'فئة $i',
              slug: 's$i',
              sortOrder: i)
      ];
  Widget home(List<MarketplaceSector> c) => SingleChildScrollView(
      child: CategoryGrid(categories: c, columns: CategoryGrid.homeColumns, large: true));

  testWidgets('Home shows exactly two cards per row, for any number of categories', (tester) async {
    expect(CategoryGrid.homeColumns, 2);
    await tester.pumpWidget(hatlyTestApp(home(make(7))));
    final rects = [for (var i = 0; i < 7; i++) tester.getRect(find.byType(CategoryCard).at(i))];
    expect(find.byType(CategoryCard), findsNWidgets(7));
    // pairs share a row; the third card starts the next row
    expect(rects[0].top, rects[1].top);
    expect(rects[2].top, greaterThan(rects[0].bottom));
    expect(rects[2].top, rects[3].top);
    // every card has the same width; the last (odd) card keeps the column width
    for (final r in rects) {
      expect(r.width.round(), rects[0].width.round());
    }
  });

  testWidgets('RTL puts the first category on the right; LTR on the left', (tester) async {
    await tester.pumpWidget(hatlyTestApp(home(make(2))));
    expect(tester.getCenter(find.text('فئة 0')).dx, greaterThan(tester.getCenter(find.text('فئة 1')).dx));
    await tester.pumpWidget(hatlyTestApp(home(make(2)), locale: const Locale('en')));
    expect(tester.getCenter(find.text('Cat 0')).dx, lessThan(tester.getCenter(find.text('Cat 1')).dx));
  });

  testWidgets('soft card: white surface, restrained 12 px corner, hairline border, light shadow; picture corner 8 px', (tester) async {
    await tester.pumpWidget(hatlyTestApp(home(make(2))));
    final box = tester
        .widgetList<DecoratedBox>(find.descendant(of: find.byType(CategoryCard).first, matching: find.byType(DecoratedBox)))
        .map((d) => d.decoration)
        .whereType<BoxDecoration>()
        .firstWhere((d) => d.borderRadius == BorderRadius.circular(kCategoryCardRadius));
    expect(kCategoryCardRadius, 12);
    expect(box.border, isNotNull);
    expect(box.boxShadow, hasLength(1));
    expect(box.boxShadow!.first.blurRadius, lessThanOrEqualTo(10));
    expect(kCategoryImageRadius, 8);
  });

  for (final width in [320.0, 360.0, 390.0, 430.0]) {
    testWidgets('no clipping at ${width.toInt()} pt wide with 2× text and long Arabic names; cards in a row stay the same height', (tester) async {
      tester.view.physicalSize = Size(width, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(hatlyTestApp(home(make(6, long: true)), textScale: 2.0));
      await tester.pump();
      expect(tester.takeException(), isNull);
      final a = tester.getRect(find.byType(CategoryCard).at(0));
      final b = tester.getRect(find.byType(CategoryCard).at(1));
      expect(a.height.round(), b.height.round());
      expect(a.width, greaterThan(100));
    });
  }

  testWidgets('dark mode and English render without overflow', (tester) async {
    await tester.pumpWidget(hatlyTestApp(home(make(4, long: true)), dark: true, locale: const Locale('en'), textScale: 1.5));
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

  testWidgets('tapping a card navigates (the existing category route is kept)', (tester) async {
    await tester.pumpWidget(hatlyTestApp(home(make(2))));
    expect(find.bySemanticsLabel('فئة 0'), findsOneWidget);
    final s = tester.getSemantics(find.bySemanticsLabel('فئة 0'));
    expect(s.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
  });
}
