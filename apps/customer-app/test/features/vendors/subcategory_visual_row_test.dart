import 'dart:ui' show Tristate;
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/sectors/data/sectors_api.dart';
import 'package:hatly_customer/features/sectors/data/sectors_providers.dart';
import 'package:hatly_customer/features/sectors/domain/subcategory.dart';
import 'package:hatly_customer/features/vendors/presentation/widgets/subcategory_chip_row.dart';

import '../../support/test_app.dart';

/// MarketplaceSubcategory (Level 1.5) is shown as a compact visual strip — a rounded image + the name on a small surface card,
/// "All" first — instead of text-only chips. Behaviour (the `subcategoryId` filter, reset, keys) is covered by
/// vendor_list_subcategory_test.dart; this file covers the visuals: image resolution + fallback, selection state, RTL, dark mode,
/// large text and tap targets.
class _FakeSectorsApi implements SectorsApi {
  _FakeSectorsApi(this.subcategories);
  final List<MarketplaceSubcategory> subcategories;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<MarketplaceSubcategory>> getSubcategories(
          String sectorId) async =>
      subcategories;
}

MarketplaceSubcategory _sub(String id, String name,
        {String? nameAr, String? imageUrl, int sortOrder = 0}) =>
    MarketplaceSubcategory(
        id: id,
        name: name,
        nameAr: nameAr,
        sortOrder: sortOrder,
        imageUrl: imageUrl);

final _subs = [
  _sub('sc-fast', 'Fast Food',
      nameAr: 'وجبات سريعة',
      imageUrl:
          '/uploads/files/marketplace/subcategories/restaurants/fast-food.webp'),
  _sub('sc-oriental', 'Oriental', nameAr: 'مأكولات شرقية'), // no image yet
  _sub('sc-cafes', 'Cafes & Desserts',
      nameAr: 'كافيهات وحلويات', imageUrl: 'stub-upload://not-a-real-image'),
];

Future<void> _pump(
  WidgetTester tester, {
  String? selected,
  ValueChanged<String?>? onChanged,
  Locale locale = const Locale('en'),
  bool dark = false,
  double textScale = 1.0,
  double width = 390,
}) async {
  tester.view.physicalSize = Size(width * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyTestApp(
    SubcategoryChipRow(
        sectorId: 's1',
        selectedSubcategoryId: selected,
        onChanged: onChanged ?? (_) {}),
    locale: locale,
    dark: dark,
    textScale: textScale,
    overrides: [sectorsApiProvider.overrideWithValue(_FakeSectorsApi(_subs))],
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
      'each subcategory is an image card with its name; "All" comes first',
      (tester) async {
    await _pump(tester);

    expect(find.text('All'), findsOneWidget);
    expect(find.text('Fast Food'), findsOneWidget);
    expect(find.text('Oriental'), findsOneWidget);
    // "All" is the first/leftmost item, then the subcategories in the order given.
    final xs = [
      for (final k in ['all', 'sc-fast', 'sc-oriental'])
        tester.getTopLeft(find.byKey(Key('subcategory-chip-$k'))).dx
    ];
    expect(xs, orderedEquals([...xs]..sort()));
    // No text-only ChoiceChips any more.
    expect(find.byType(ChoiceChip), findsNothing);
  });

  testWidgets(
      'the image goes through the shared media resolver: a server-relative path becomes an absolute URL',
      (tester) async {
    await _pump(tester);

    final images = tester
        .widgetList<CachedNetworkImage>(find.byType(CachedNetworkImage))
        .toList();
    expect(images, hasLength(1),
        reason:
            'only Fast Food has a loadable image; the others use the placeholder');
    expect(Uri.parse(images.single.imageUrl).hasScheme, isTrue);
    expect(
        images.single.imageUrl,
        endsWith(
            '/uploads/files/marketplace/subcategories/restaurants/fast-food.webp'));
    expect(images.single.imageUrl, isNot(contains('/api/v1/uploads')));
  });

  testWidgets(
      'a missing or unusable image falls back to the placeholder icon — never a broken image or empty box',
      (tester) async {
    await _pump(tester);

    for (final id in ['sc-oriental', 'sc-cafes']) {
      final card = find.byKey(Key('subcategory-chip-$id'));
      expect(
          find.descendant(of: card, matching: find.byType(CachedNetworkImage)),
          findsNothing);
      expect(
          find.descendant(
              of: card, matching: find.byIcon(Icons.category_outlined)),
          findsOneWidget);
      expect(
          find.descendant(
              of: card, matching: find.byIcon(Icons.broken_image_outlined)),
          findsNothing);
    }
    // "All" is an icon tile, not an image.
    expect(
        find.descendant(
            of: find.byKey(const Key('subcategory-chip-all')),
            matching: find.byIcon(Icons.apps_rounded)),
        findsOneWidget);
  });

  testWidgets(
      'tapping reports the subcategory id; tapping "All" reports null (reset)',
      (tester) async {
    final taps = <String?>[];
    await _pump(tester, selected: 'sc-fast', onChanged: taps.add);

    await tester.tap(find.byKey(const Key('subcategory-chip-sc-oriental')));
    await tester.tap(find.byKey(const Key('subcategory-chip-all')));
    expect(taps, ['sc-oriental', null]);
  });

  testWidgets(
      'the selected item is exposed as selected to accessibility; others are not',
      (tester) async {
    final handle = tester.ensureSemantics();
    await _pump(tester, selected: 'sc-oriental');

    SemanticsNode node(String id) =>
        tester.getSemantics(find.byKey(Key('subcategory-chip-$id')));
    bool selected(String id) =>
        node(id).getSemanticsData().flagsCollection.isSelected ==
        Tristate.isTrue;
    expect(selected('sc-oriental'), isTrue);
    expect(node('sc-oriental').getSemanticsData().flagsCollection.isButton,
        isTrue);
    expect(node('sc-oriental').label, 'Oriental');
    expect(selected('sc-fast'), isFalse);
    expect(selected('all'), isFalse);
    handle.dispose();

    final handle2 = tester.ensureSemantics();
    await _pump(tester, selected: null);
    expect(
        tester
            .getSemantics(find.byKey(const Key('subcategory-chip-all')))
            .getSemanticsData()
            .flagsCollection
            .isSelected,
        Tristate.isTrue);
    handle2.dispose();
  });

  testWidgets('every item is a comfortable tap target (>= 44 dp tall and wide)',
      (tester) async {
    await _pump(tester);
    for (final k in ['all', 'sc-fast', 'sc-oriental', 'sc-cafes']) {
      final size = tester.getSize(find.byKey(Key('subcategory-chip-$k')));
      expect(size.height, greaterThanOrEqualTo(44), reason: k);
      expect(size.width, greaterThanOrEqualTo(44), reason: k);
    }
  });

  testWidgets(
      'Arabic (RTL): Arabic names are used and "All" is the first item on the RIGHT',
      (tester) async {
    await _pump(tester, locale: const Locale('ar'));

    expect(find.text('وجبات سريعة'), findsOneWidget);
    expect(find.text('Fast Food'), findsNothing);
    expect(
        Directionality.of(
            tester.element(find.byKey(const Key('subcategory-chip-all')))),
        TextDirection.rtl);
    final allX =
        tester.getCenter(find.byKey(const Key('subcategory-chip-all'))).dx;
    final fastX =
        tester.getCenter(find.byKey(const Key('subcategory-chip-sc-fast'))).dx;
    expect(allX, greaterThan(fastX));
  });

  for (final dark in [false, true]) {
    for (final locale in [const Locale('en'), const Locale('ar')]) {
      for (final scale in [1.0, 2.0]) {
        testWidgets(
            'renders without overflow: ${dark ? 'dark' : 'light'} ${locale.languageCode} text x$scale on a 320 dp screen',
            (tester) async {
          await _pump(tester,
              dark: dark,
              locale: locale,
              textScale: scale,
              width: 320,
              selected: 'sc-cafes');
          expect(tester.takeException(), isNull);
          expect(find.byKey(const Key('subcategory-chip-sc-cafes')),
              findsOneWidget);
        });
      }
    }
  }

  testWidgets(
      'selected and unselected items differ visibly (border) in both themes',
      (tester) async {
    for (final dark in [false, true]) {
      await _pump(tester, dark: dark, selected: 'sc-fast');
      BorderSide side(String id) {
        final material = tester.widget<Material>(find
            .descendant(
                of: find.byKey(Key('subcategory-chip-$id')),
                matching: find.byType(Material))
            .first);
        return (material.shape as RoundedRectangleBorder).side;
      }

      expect(side('sc-fast').width, greaterThan(side('sc-oriental').width),
          reason: 'dark=$dark');
      expect(side('sc-fast').color, isNot(equals(side('sc-oriental').color)),
          reason: 'dark=$dark');
    }
  });
}
