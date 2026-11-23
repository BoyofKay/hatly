import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/features/vendors/domain/opening_hours.dart';
import 'package:hatly_customer/features/vendors/domain/vendor.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_branch_summary.dart';
import 'package:hatly_customer/features/vendors/presentation/widgets/vendor_cover_card.dart';

// Owner request 2026-11-23: a store outside its working hours is greyed, shows today's hours, and a tap opens
// "[store] is closed" with Close / View menu instead of going straight to the menu.

Vendor _vendor(
        {required bool open,
        Map<String, OpeningHoursRange> hours = const {}}) =>
    Vendor(
      id: 'v1',
      name: 'Tarweqa',
      nameAr: 'ترويقة',
      category: '',
      ratingAverage: 0,
      ratingCount: 0,
      etaMinMinutes: 0,
      etaMaxMinutes: 0,
      deliveryFeeMinor: 0,
      isOpen: open,
      openingHours: hours,
    );

final _everyDay = {
  for (final d in ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
    d: const OpeningHoursRange(open: '12:00', close: '02:00'),
};

Widget _host(Widget child, {Locale locale = const Locale('en')}) => MaterialApp(
      theme: HatlyTheme.light(),
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: Scaffold(body: Center(child: SizedBox(width: 340, child: child))),
    );

void main() {
  group('opening hours', () {
    test('parses the server shape and skips malformed days', () {
      final h = openingHoursFromJson({
        'mon': {'open': '09:00', 'close': '17:00'},
        'tue': 'bad',
        'wed': {'open': 9},
      });
      expect(h.keys, ['mon']);
      expect(openingHoursFromJson(null), isEmpty);
    });

    test("today's label: hours, 24 hours, closed today, none", () async {
      final l10n = await AppLocalizations.delegate.load(const Locale('en'));
      final monday = DateTime(2026, 11, 23, 10); // a Monday
      expect(
          todayHoursLabel({
            'mon': const OpeningHoursRange(open: '12:00', close: '02:00')
          }, l10n, now: monday),
          '\u206612:00–02:00\u2069');
      expect(
          todayHoursLabel({
            'mon': const OpeningHoursRange(open: '00:00', close: '00:00')
          }, l10n, now: monday),
          'Open 24 hours');
      expect(
          todayHoursLabel({
            'tue': const OpeningHoursRange(open: '12:00', close: '20:00')
          }, l10n, now: monday),
          'Closed today');
      expect(todayHoursLabel(const {}, l10n, now: monday), isNull);
    });
  });

  testWidgets(
      'a closed store: tap shows the popup; View menu opens the menu, Close does not',
      (tester) async {
    var opened = 0;
    await tester.pumpWidget(_host(VendorCoverCard(
        vendor: _vendor(open: false, hours: _everyDay),
        onTap: () => opened++)));
    await tester.pumpAndSettle();

    expect(find.text('Closed'), findsOneWidget);
    expect(find.byKey(const Key('vendor-card-hours-v1')), findsOneWidget);

    await tester.tap(find.byType(VendorCoverCard));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('vendor-closed-dialog')), findsOneWidget);
    expect(find.text('Tarweqa is closed'), findsOneWidget);
    expect(opened, 0);

    await tester.tap(find.byKey(const Key('vendor-closed-dialog-close')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('vendor-closed-dialog')), findsNothing);
    expect(opened, 0);

    await tester.tap(find.byType(VendorCoverCard));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('vendor-closed-dialog-view-menu')));
    await tester.pumpAndSettle();
    expect(opened, 1);
  });

  testWidgets('an open store opens straight away', (tester) async {
    var opened = 0;
    await tester.pumpWidget(_host(
        VendorCoverCard(vendor: _vendor(open: true), onTap: () => opened++)));
    await tester.tap(find.byType(VendorCoverCard));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('vendor-closed-dialog')), findsNothing);
    expect(opened, 1);
    expect(find.byKey(const Key('vendor-card-hours-v1')),
        findsNothing); // no hours set → nothing invented
  });

  testWidgets('Arabic popup', (tester) async {
    await tester.pumpWidget(_host(
        VendorCoverCard(
            vendor: _vendor(open: false, hours: _everyDay), onTap: () {}),
        locale: const Locale('ar')));
    await tester.tap(find.byType(VendorCoverCard));
    await tester.pumpAndSettle();
    expect(find.text('ترويقة مغلق الآن'), findsOneWidget);
    expect(find.text('عرض القائمة'), findsOneWidget);
  });
}
