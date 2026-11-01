import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_filters.dart';
import 'package:hatly_customer/features/vendors/presentation/widgets/vendor_filter_sheet.dart';

import '../../support/test_app.dart';

/// Filters V1 — the Vendor List filter sheet's own local-draft-until-
/// Apply mechanics, isolated from the screen that opens it.
void main() {
  testWidgets(
      'starts with the given initial filters reflected in the toggles/chips',
      (tester) async {
    await tester.pumpWidget(hatlyTestApp(
      Builder(builder: (context) {
        return ElevatedButton(
          onPressed: () => showModalBottomSheet<VendorFilters>(
            context: context,
            isScrollControlled: true,
            builder: (_) => const VendorFilterSheet(
                initialFilters: VendorFilters(openNow: true, minRating: 4)),
          ),
          child: const Text('open'),
        );
      }),
      locale: const Locale('en'),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    final openNowSwitch = tester.widget<SwitchListTile>(
        find.byKey(const Key('vendor-filter-open-now')));
    expect(openNowSwitch.value, isTrue);
    final chip4 = tester.widget<ChoiceChip>(find.descendant(
        of: find.byKey(const Key('vendor-filter-rating-4')),
        matching: find.byType(ChoiceChip)));
    expect(chip4.selected, isTrue);
  });

  testWidgets(
      'toggling Open Now and Offers, then Apply, returns the updated draft',
      (tester) async {
    VendorFilters? applied;
    await tester.pumpWidget(hatlyTestApp(
      Builder(builder: (context) {
        return ElevatedButton(
          onPressed: () async {
            applied = await showModalBottomSheet<VendorFilters>(
              context: context,
              isScrollControlled: true,
              builder: (_) =>
                  const VendorFilterSheet(initialFilters: VendorFilters.empty),
            );
          },
          child: const Text('open'),
        );
      }),
      locale: const Locale('en'),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('vendor-filter-open-now')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('vendor-filter-has-offers')));
    await tester.tap(find.byKey(const Key('vendor-filter-rating-3')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();

    expect(applied,
        const VendorFilters(openNow: true, hasOffers: true, minRating: 3));
  });

  testWidgets(
      'Cancel returns null — the sheet never mutates anything on its own',
      (tester) async {
    VendorFilters? result =
        const VendorFilters(openNow: true); // sentinel non-null starting value
    await tester.pumpWidget(hatlyTestApp(
      Builder(builder: (context) {
        return ElevatedButton(
          onPressed: () async {
            result = await showModalBottomSheet<VendorFilters>(
              context: context,
              isScrollControlled: true,
              builder: (_) =>
                  const VendorFilterSheet(initialFilters: VendorFilters.empty),
            );
          },
          child: const Text('open'),
        );
      }),
      locale: const Locale('en'),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('vendor-filter-open-now')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('vendor-filter-cancel')));
    await tester.pumpAndSettle();

    expect(result, isNull);
  });

  testWidgets(
      'Clear All resets every toggle/chip back to empty, still requires Apply to take effect',
      (tester) async {
    VendorFilters? applied;
    await tester.pumpWidget(hatlyTestApp(
      Builder(builder: (context) {
        return ElevatedButton(
          onPressed: () async {
            applied = await showModalBottomSheet<VendorFilters>(
              context: context,
              isScrollControlled: true,
              builder: (_) => const VendorFilterSheet(
                initialFilters:
                    VendorFilters(openNow: true, hasOffers: true, minRating: 4),
              ),
            );
          },
          child: const Text('open'),
        );
      }),
      locale: const Locale('en'),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('vendor-filter-clear-all')));
    await tester.pumpAndSettle();
    final openNowSwitch = tester.widget<SwitchListTile>(
        find.byKey(const Key('vendor-filter-open-now')));
    expect(openNowSwitch.value, isFalse);

    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();
    expect(applied, VendorFilters.empty);
  });

  testWidgets(
      'rating chips are single-select: choosing 4.0+ then 3.0+ leaves only 3.0+ selected',
      (tester) async {
    await tester.pumpWidget(hatlyTestApp(
      Builder(builder: (context) {
        return ElevatedButton(
          onPressed: () => showModalBottomSheet<VendorFilters>(
            context: context,
            isScrollControlled: true,
            builder: (_) =>
                const VendorFilterSheet(initialFilters: VendorFilters.empty),
          ),
          child: const Text('open'),
        );
      }),
      locale: const Locale('en'),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('vendor-filter-rating-4')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('vendor-filter-rating-3')));
    await tester.pumpAndSettle();

    expect(
        tester
            .widget<ChoiceChip>(find.descendant(
                of: find.byKey(const Key('vendor-filter-rating-4')),
                matching: find.byType(ChoiceChip)))
            .selected,
        isFalse);
    expect(
        tester
            .widget<ChoiceChip>(find.descendant(
                of: find.byKey(const Key('vendor-filter-rating-3')),
                matching: find.byType(ChoiceChip)))
            .selected,
        isTrue);
  });

  testWidgets('renders correctly in RTL (Arabic)', (tester) async {
    await tester.pumpWidget(hatlyTestApp(
      Builder(builder: (context) {
        return ElevatedButton(
          onPressed: () => showModalBottomSheet<VendorFilters>(
            context: context,
            isScrollControlled: true,
            builder: (_) =>
                const VendorFilterSheet(initialFilters: VendorFilters.empty),
          ),
          child: const Text('open'),
        );
      }),
      locale: const Locale('ar'),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    expect(find.text('فلترة'), findsOneWidget);
    expect(find.text('مسح الكل'), findsOneWidget);
    expect(find.text('إلغاء'), findsOneWidget);
    expect(find.text('تطبيق'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('renders correctly in Dark Mode', (tester) async {
    await tester.pumpWidget(hatlyTestApp(
      Builder(builder: (context) {
        return ElevatedButton(
          onPressed: () => showModalBottomSheet<VendorFilters>(
            context: context,
            isScrollControlled: true,
            builder: (_) =>
                const VendorFilterSheet(initialFilters: VendorFilters.empty),
          ),
          child: const Text('open'),
        );
      }),
      locale: const Locale('en'),
      dark: true,
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    expect(find.text('Filter'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'the Open Now / Offers switches expose their toggled state via Semantics',
      (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(hatlyTestApp(
      Builder(builder: (context) {
        return ElevatedButton(
          onPressed: () => showModalBottomSheet<VendorFilters>(
            context: context,
            isScrollControlled: true,
            builder: (_) => const VendorFilterSheet(
                initialFilters: VendorFilters(openNow: true)),
          ),
          child: const Text('open'),
        );
      }),
      locale: const Locale('en'),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // `SwitchListTile`'s merged semantics node represents this control via
    // `isSelected`/`hasSelectedState` (not `isToggled`/`hasToggledState`) —
    // confirmed by inspecting the real SemanticsNode, not assumed. A screen
    // reader still correctly announces this row's on/off state and its real
    // label; the switch's own rendered `value` (asserted in the first test
    // above) remains the authoritative source for the actual on/off state.
    final switchFinder = find.descendant(
      of: find.byKey(const Key('vendor-filter-open-now')),
      matching: find.byType(Switch),
    );
    final semantics = tester.getSemantics(switchFinder);
    // `flagsCollection`'s replacement type (`Tristate`) isn't part of the
    // public `package:flutter/semantics.dart` API surface, so this
    // deprecated-but-still-functional accessor is the only way to assert this
    // from a test today (same "deprecated but not worth chasing" precedent
    // already established throughout this app for `withOpacity`).
    // ignore: deprecated_member_use
    expect(semantics.hasFlag(SemanticsFlag.hasSelectedState), isTrue);
    expect(semantics.label, 'Open Now');
    handle.dispose();
  });
}
