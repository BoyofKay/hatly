import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/utils/whatsapp_helper.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';
import 'package:hatly_customer/features/orders/domain/order_details.dart';
import 'package:hatly_customer/features/orders/presentation/order_details_screen.dart';
import 'package:hatly_customer/features/profile/presentation/profile_screen.dart';
import 'package:hatly_customer/features/ratings/data/rating_api.dart';
import 'package:hatly_customer/features/ratings/data/rating_providers.dart';
import 'package:hatly_customer/features/support/data/support_contact_api.dart';
import 'package:hatly_customer/features/support/data/support_providers.dart';

import '../../support/test_app.dart';

/// The Hatly customer-service WhatsApp number is CONFIGURATION (`CUSTOMER_SERVICE_WHATSAPP_NUMBER`, served by `GET /support/contact`),
/// never a constant in the app. These tests use the real production number AS CONFIGURED ("+201104949903") and prove both entry
/// points build exactly `https://wa.me/201104949903` — digits only, no "+", no spaces, no duplicated country code.
const _configured = '+201104949903';
const _orderId = '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab';

OrderDetails _order() => OrderDetails(
      id: _orderId,
      orderNumber: 'HT-100001',
      createdAt: DateTime(2026, 9, 1, 12),
      status: 'PENDING',
      fulfillmentType: 'DELIVERY',
      subtotalMinor: 0,
      deliveryFeeMinor: 11000,
      discountMinor: 0,
      paymentMethod: 'COD',
      hasPendingPricing: true,
      segments: const [],
    );

List<Override> _overrides(List<Uri> launched, {String? number = _configured}) =>
    [
      supportContactProvider
          .overrideWith((ref) async => SupportContact(whatsappNumber: number)),
      whatsAppLauncherProvider.overrideWithValue((uri) async {
        launched.add(uri);
        return true;
      }),
      orderDetailsProvider.overrideWith((ref, id) async => _order()),
      orderRatingStateProvider.overrideWith(
          (ref, id) => Future<OrderRatingState>.error(Exception('none'))),
    ];

Future<void> _pump(
    WidgetTester tester, Widget screen, List<Override> overrides) async {
  tester.view.physicalSize = const Size(390 * 3, 1800 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyTestApp(screen, overrides: overrides));
  await tester.pumpAndSettle();
}

void main() {
  group('the URL', () {
    test(
        'every accepted formatting of the configured number yields the same digits-only wa.me link',
        () {
      for (final raw in [
        '+201104949903',
        '201104949903',
        '+20 110 494 9903',
        '+20-110-494-9903',
        ' +201104949903 '
      ]) {
        expect(buildWhatsAppUri(phoneNumber: raw).toString(),
            'https://wa.me/201104949903',
            reason: raw);
      }
    });

    test('the message is URL-encoded and the number never appears twice', () {
      final uri = buildWhatsAppUri(
          phoneNumber: _configured, message: 'مرحبًا Hatly، أحتاج إلى مساعدة.');
      expect(uri.host, 'wa.me');
      expect(uri.path, '/201104949903');
      expect(uri.queryParameters['text'], 'مرحبًا Hatly، أحتاج إلى مساعدة.');
      expect(uri.toString().split('201104949903'), hasLength(2));
    });

    test(
        'the configured value is taken from the server as-is (not hardcoded): another number gives another link',
        () {
      expect(buildWhatsAppUri(phoneNumber: '+201000000000').toString(),
          'https://wa.me/201000000000');
      expect(
          SupportContact.fromJson({'whatsappNumber': _configured})
              .whatsappNumber,
          _configured);
    });
  });

  group('Profile → "تواصل مع Hatly"', () {
    testWidgets('opens the configured number with the general message',
        (tester) async {
      final launched = <Uri>[];
      await _pump(tester, const ProfileScreen(), _overrides(launched));
      expect(find.text('تواصل مع Hatly'), findsOneWidget);
      await tester.tap(find.byKey(const Key('profile-support-contact')));
      await tester.pumpAndSettle();
      expect(launched, hasLength(1));
      expect(launched.single.scheme, 'https');
      expect(launched.single.host, 'wa.me');
      expect(launched.single.path, '/201104949903');
      expect(launched.single.queryParameters['text'],
          'مرحبًا Hatly، أحتاج إلى مساعدة.');
    });
  });

  group('Order Details → "تواصل مع Hatly بخصوص الطلب"', () {
    testWidgets(
        'opens the configured number with a message carrying the FULL order id',
        (tester) async {
      final launched = <Uri>[];
      await _pump(tester, const OrderDetailsScreen(orderId: _orderId),
          _overrides(launched));
      expect(find.text('تواصل مع Hatly بخصوص الطلب'), findsOneWidget);
      await tester
          .ensureVisible(find.byKey(const Key('order-support-contact')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('order-support-contact')));
      await tester.pumpAndSettle();
      expect(launched, hasLength(1));
      expect(launched.single.path, '/201104949903');
      final text = launched.single.queryParameters['text']!;
      expect(text, 'مرحبًا Hatly، أحتاج إلى مساعدة بخصوص الطلب رقم $_orderId.');
      expect(text, contains(_orderId),
          reason: 'the full id, not a truncated one');
    });

    testWidgets(
        'with no number configured the contextual action is hidden, nothing launches',
        (tester) async {
      final launched = <Uri>[];
      await _pump(tester, const OrderDetailsScreen(orderId: _orderId),
          _overrides(launched, number: null));
      // (the tile widget itself is still in the tree — it renders nothing — so look for what would be visible)
      expect(find.text('تواصل مع Hatly بخصوص الطلب'), findsNothing);
      expect(launched, isEmpty);
    });
  });
}
