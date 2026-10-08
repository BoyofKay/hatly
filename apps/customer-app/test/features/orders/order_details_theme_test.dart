import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';
import 'package:hatly_customer/features/orders/domain/order_details.dart';
import 'package:hatly_customer/features/orders/presentation/order_details_screen.dart';
import 'package:hatly_customer/features/orders/presentation/order_status_label.dart';
import 'package:hatly_customer/features/ratings/data/rating_api.dart';
import 'package:hatly_customer/features/ratings/data/rating_providers.dart';
import 'package:hatly_customer/features/support/data/support_contact_api.dart';
import 'package:hatly_customer/features/support/data/support_providers.dart';
import 'package:hatly_customer/shared_widgets/hatly_card.dart';

import '../../support/test_app.dart';

/// Order Details renders on palette surfaces (not the fixed-white legacy `HatlyCard`), so its content stays readable
/// in Dark Mode while Light Mode is unchanged.
const _id = '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab';

OrderDetails _order({String status = 'CANCELLED'}) => OrderDetails(
      id: _id,
      orderNumber: 'HT-100001',
      createdAt: DateTime(2026, 9, 1, 12),
      status: status,
      fulfillmentType: 'DELIVERY',
      subtotalMinor: 10000,
      deliveryFeeMinor: 1500,
      discountMinor: 500,
      totalMinor: 11000,
      paymentMethod: 'COD',
      cancellationReason: 'Vendor closed',
      cancelledByRole: 'VENDOR',
      driver: const OrderDriverDetails(name: 'Ahmed', phone: '+201000000001'),
      segments: [
        OrderSegmentDetails(
          id: 's1',
          groupType: 'CATALOG',
          vendorBranchName: 'مطعم النخيل',
          status: status,
          subtotalMinor: 10000,
          offerDiscountAmountMinor: 500,
          items: const [
            OrderItemDetails(
                id: 'i1',
                productId: 'p1',
                productNameSnapshot: 'برجر لحم',
                quantity: 2,
                unitPriceMinor: 5000,
                optionsSnapshot: [],
                offerMechanismSnapshot: 'FLASH_SALE',
                offerSpecialPriceMinorSnapshot: 4500),
            OrderItemDetails(
                id: 'i2',
                freeTextDescriptionSnapshot: 'Panadol',
                quantity: 1,
                actualAmountMinor: 3000,
                optionsSnapshot: []),
          ],
        ),
      ],
    );

Future<void> _pump(WidgetTester tester,
    {required bool dark,
    double scale = 1.0,
    Locale locale = const Locale('ar'),
    String status = 'CANCELLED'}) async {
  // Tall enough that the whole (lazy) list is built and can be inspected.
  tester.view.physicalSize = const Size(390 * 3, 2400 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyTestApp(const OrderDetailsScreen(orderId: _id),
      dark: dark,
      locale: locale,
      textScale: scale,
      overrides: [
        orderDetailsProvider
            .overrideWith((ref, id) async => _order(status: status)),
        orderRatingStateProvider.overrideWith(
            (ref, id) => Future<OrderRatingState>.error(Exception('none'))),
        supportContactProvider.overrideWith((ref) async =>
            const SupportContact(whatsappNumber: '+201000000000')),
      ]));
  await tester.pumpAndSettle();
}

double _luminance(Color c) => c.computeLuminance();
double _contrast(Color a, Color b) {
  final la = _luminance(a), lb = _luminance(b);
  final hi = la > lb ? la : lb, lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

/// The card decorations (surface + border) drawn by Order Details.
List<BoxDecoration> _cardDecorations(WidgetTester tester) => tester
    .widgetList<Container>(find.byType(Container))
    .map((c) => c.decoration)
    .whereType<BoxDecoration>()
    .where((d) => d.border != null && d.borderRadius != null)
    .toList();

void main() {
  for (final dark in [false, true]) {
    final palette = dark ? HatlyPalette.dark : HatlyPalette.light;
    final mode = dark ? 'Dark' : 'Light';

    group('Order Details — $mode surfaces', () {
      testWidgets(
          'cards use the theme palette surface + border, never the fixed-white legacy HatlyCard',
          (tester) async {
        await _pump(tester, dark: dark);
        expect(find.byType(HatlyCard), findsNothing);

        final decorations = _cardDecorations(tester);
        // reason card, driver card, vendor segment card, totals card
        expect(decorations.length, greaterThanOrEqualTo(4));
        for (final d in decorations) {
          expect(d.color, palette.surface);
          expect((d.border as Border).top.color, palette.border);
        }
      });

      testWidgets(
          'card text stays readable against its surface (Dark >= 4.5:1; Light unchanged, >= 3:1)',
          (tester) async {
        await _pump(tester, dark: dark);
        final texts = tester
            .widgetList<RichText>(find.descendant(
                of: find.byType(ListView), matching: find.byType(RichText)))
            .where((r) {
          final t = r.text.toPlainText().trim();
          // Icons are RichText too (a single private-use glyph) — this check is about text, not icons.
          return t.isNotEmpty && t.runes.first < 0xE000;
        });
        expect(texts, isNotEmpty);
        // Dark must reach 4.5:1. Light Mode is deliberately unchanged, and the existing brand-orange (#E0650A) flash-sale
        // label is 3.5:1 on white, so Light is held to the 3:1 non-regression floor instead.
        final minContrast = dark ? 4.5 : 3.0;
        final failures = <String>[];
        for (final r in texts) {
          final style = r.text.style;
          final color = style?.color;
          if (color == null) {
            continue;
          }
          // Status badges tint their own background; their contrast is asserted separately below.
          if (r.text.toPlainText() == 'ملغي' ||
              r.text.toPlainText() == 'Cancelled') {
            continue;
          }
          final c = _contrast(color.withAlpha(255), palette.surface);
          if (c < minContrast) {
            failures.add('"${r.text.toPlainText()}" ${c.toStringAsFixed(2)}');
          }
        }
        expect(failures, isEmpty, reason: failures.join('; '));
      });

      testWidgets(
          'all order content is present: reason, driver, vendor, items, totals, support tile',
          (tester) async {
        await _pump(tester, dark: dark, locale: const Locale('en'));
        expect(find.text('Vendor closed'), findsOneWidget);
        expect(find.text('Ahmed'), findsOneWidget);
        expect(find.text('مطعم النخيل'), findsOneWidget);
        expect(find.text('برجر لحم'), findsOneWidget);
        expect(find.text('Total'), findsOneWidget);
        expect(find.text('Contact Hatly about this order'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });

      testWidgets('2× text, RTL: no overflow', (tester) async {
        await _pump(tester, dark: dark, scale: 2.0);
        expect(tester.takeException(), isNull);
      });
    });
  }

  // Dark Mode implementation: `OrderStatusBadge` used to take a `themeAware`
  // flag because only Order Details had been migrated onto palette surfaces
  // (the Orders list still used a fixed-colour legacy path). Every real call
  // site (Orders list, Order Details, Tracking) now already passed
  // `themeAware: true`, so the flag and the legacy branch it gated were dead
  // code — removed. The badge is now always palette-driven; these tests
  // cover that single behaviour instead of the old flag.
  group('OrderStatusBadge is theme-aware', () {
    Future<Color> badgeTextColor(WidgetTester tester,
        {required bool dark, String status = 'DELIVERED'}) async {
      await tester.pumpWidget(
          hatlyTestApp(OrderStatusBadge(status: status), dark: dark));
      await tester.pumpAndSettle();
      final text = tester.widget<Text>(find.descendant(
          of: find.byType(OrderStatusBadge), matching: find.byType(Text)));
      return text.style!.color!;
    }

    testWidgets('Light Mode colours are identical to the old fixed ones',
        (tester) async {
      expect(await badgeTextColor(tester, dark: false, status: 'DELIVERED'),
          HatlyColors.success);
      expect(await badgeTextColor(tester, dark: false, status: 'CANCELLED'),
          HatlyColors.error);
      expect(await badgeTextColor(tester, dark: false, status: 'PENDING'),
          HatlyColors.primaryOrange);
    });

    testWidgets('Dark Mode badge text is readable on the dark surface',
        (tester) async {
      for (final status in [
        'DELIVERED',
        'CANCELLED',
        'FAILED_DELIVERY',
        'PENDING'
      ]) {
        final color =
            await badgeTextColor(tester, dark: true, status: status);
        expect(_contrast(color, HatlyPalette.dark.surface),
            greaterThanOrEqualTo(4.5),
            reason: status);
      }
    });
  });
}
