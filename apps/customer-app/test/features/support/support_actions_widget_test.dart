import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
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

const _orderId = '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab';
const _profileKey = Key('profile-support-contact');
const _orderKey = Key('order-support-contact');

OrderDetails _order() => OrderDetails(
      id: _orderId,
      orderNumber: 'HT-100001',
      createdAt: DateTime(2026, 9, 1, 12),
      status: 'PENDING',
      fulfillmentType: 'DELIVERY',
      subtotalMinor: 10000,
      deliveryFeeMinor: 1500,
      discountMinor: 0,
      totalMinor: 11500,
      paymentMethod: 'COD',
      segments: const [],
    );

class _ThrowingSupportApi implements SupportContactApi {
  @override
  Future<SupportContact> getContact() async => throw Exception('500 secret');
}

class _Recorder {
  final calls = <Uri>[];
  bool result = true;
  bool throws = false;

  /// When set, [call] waits on it instead of resolving immediately — lets
  /// a test hold the first launch open to simulate a slow launcher while
  /// it fires a second tap.
  Completer<void>? gate;

  Future<bool> call(Uri uri) async {
    calls.add(uri);
    if (gate != null) await gate!.future;
    if (throws) throw Exception('launcher exploded');
    return result;
  }
}

List<Override> _overrides(
  _Recorder recorder, {
  Future<SupportContact> Function()? contact,
}) =>
    [
      supportContactProvider.overrideWith((ref) => (contact ??
          () async => const SupportContact(whatsappNumber: '+201000000000'))()),
      whatsAppLauncherProvider.overrideWithValue(recorder.call),
      orderDetailsProvider.overrideWith((ref, id) async => _order()),
      orderRatingStateProvider.overrideWith(
          (ref, id) => Future<OrderRatingState>.error(Exception('no rating'))),
    ];

Future<void> _pump(
  WidgetTester tester,
  Widget screen,
  _Recorder recorder, {
  Future<SupportContact> Function()? contact,
  bool dark = false,
  Locale locale = const Locale('ar'),
  double textScale = 1.0,
}) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyTestApp(screen,
      dark: dark,
      locale: locale,
      textScale: textScale,
      overrides: _overrides(recorder, contact: contact)));
  await tester.pumpAndSettle();
}

Future<void> _scrollTo(WidgetTester tester, Key key) async {
  await tester.scrollUntilVisible(find.byKey(key), 200,
      scrollable: find.byType(Scrollable).first);
}

void main() {
  group('Profile — general support action', () {
    testWidgets(
        'shows "تواصل مع Hatly" and opens wa.me with the general message',
        (tester) async {
      final rec = _Recorder();
      await _pump(tester, const ProfileScreen(), rec);

      expect(find.text('تواصل مع Hatly'), findsOneWidget);
      await tester.tap(find.byKey(_profileKey));
      await tester.pumpAndSettle();

      expect(rec.calls, hasLength(1));
      expect(rec.calls.single.host, 'wa.me');
      expect(rec.calls.single.path, '/201000000000');
      expect(rec.calls.single.queryParameters['text'],
          'مرحبًا Hatly، أحتاج إلى مساعدة.');
      // The general support message never carries an order reference or payment-proof wording.
      expect(rec.calls.single.toString(), isNot(contains(_orderId)));
    });

    testWidgets(
        'unavailable configuration: the action stays but is disabled with a reason, and nothing launches',
        (tester) async {
      final rec = _Recorder();
      await _pump(tester, const ProfileScreen(), rec,
          contact: () async => const SupportContact());

      expect(find.text('التواصل مع Hatly غير متاح حاليًا'), findsOneWidget);
      await tester.tap(find.byKey(_profileKey), warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(rec.calls, isEmpty);
      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets(
        'launch returning false shows a localized, non-blocking message (no crash)',
        (tester) async {
      final rec = _Recorder()..result = false;
      await _pump(tester, const ProfileScreen(), rec);

      await tester.tap(find.byKey(_profileKey));
      await tester.pumpAndSettle();

      expect(find.text('تعذّر فتح واتساب. حاول مرة أخرى.'), findsOneWidget);
      expect(tester.takeException(), isNull);
      // Still usable afterwards.
      expect(find.text('تواصل مع Hatly'), findsOneWidget);
    });

    testWidgets(
        'launcher throwing is caught — localized message, no crash, no raw error text',
        (tester) async {
      final rec = _Recorder()..throws = true;
      await _pump(tester, const ProfileScreen(), rec);

      await tester.tap(find.byKey(_profileKey));
      await tester.pumpAndSettle();

      expect(find.text('تعذّر فتح واتساب. حاول مرة أخرى.'), findsOneWidget);
      expect(find.textContaining('exploded'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets(
        'a failed number load (real provider, throwing API) is unavailable — disabled with the fallback text, no backend detail shown',
        (tester) async {
      tester.view.physicalSize = const Size(390 * 3, 844 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(hatlyTestApp(const ProfileScreen(), overrides: [
        supportContactApiProvider.overrideWithValue(_ThrowingSupportApi()),
      ]));
      await tester.pumpAndSettle();
      expect(find.text('التواصل مع Hatly غير متاح حاليًا'), findsOneWidget);
      expect(find.textContaining('secret'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('English locale (LTR) shows the English label', (tester) async {
      final rec = _Recorder();
      await _pump(tester, const ProfileScreen(), rec,
          locale: const Locale('en'));
      expect(find.text('Contact Hatly'), findsOneWidget);
      await tester.tap(find.byKey(_profileKey));
      await tester.pumpAndSettle();
      expect(rec.calls.single.queryParameters['text'],
          'Hi Hatly, I need some help.');
    });

    for (final dark in [false, true]) {
      testWidgets(
          'RTL, ${dark ? 'dark' : 'light'}: renders without overflow; icon leads and arrow trails',
          (tester) async {
        final rec = _Recorder();
        await _pump(tester, const ProfileScreen(), rec, dark: dark);

        expect(tester.takeException(), isNull);
        final iconX = tester.getCenter(find.byIcon(Icons.chat_outlined)).dx;
        final arrowX =
            tester.getCenter(find.byIcon(Icons.arrow_outward_rounded)).dx;
        // Arabic = RTL: the leading icon sits on the right of the trailing arrow.
        expect(iconX, greaterThan(arrowX));
        expect(Directionality.of(tester.element(find.byKey(_profileKey))),
            TextDirection.rtl);
      });
    }

    testWidgets('large text (2.0×): no overflow and the action stays reachable',
        (tester) async {
      final rec = _Recorder();
      await _pump(tester, const ProfileScreen(), rec, textScale: 2.0);
      expect(tester.takeException(), isNull);
      await _scrollTo(tester, _profileKey);
      await tester.tap(find.byKey(_profileKey));
      await tester.pumpAndSettle();
      expect(rec.calls, hasLength(1));
      expect(tester.takeException(), isNull);
    });

    testWidgets('semantics: one enabled button labelled with the action',
        (tester) async {
      final handle = tester.ensureSemantics();
      await _pump(tester, const ProfileScreen(), _Recorder());
      final node = tester.getSemantics(find.byKey(_profileKey));
      expect(node.label, contains('تواصل مع Hatly'));
      expect(node.label, contains('نرد عليك عبر واتساب'));
      expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
      handle.dispose();
    });

    testWidgets('semantics: the disabled state says why and offers no tap',
        (tester) async {
      final handle = tester.ensureSemantics();
      await _pump(tester, const ProfileScreen(), _Recorder(),
          contact: () async => const SupportContact());
      final node = tester.getSemantics(find.byKey(_profileKey));
      expect(node.label, contains('غير متاح'));
      expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isFalse);
      handle.dispose();
    });

    testWidgets('the tap target is at least 44dp tall', (tester) async {
      final rec = _Recorder();
      await _pump(tester, const ProfileScreen(), rec);
      expect(tester.getSize(find.byKey(_profileKey)).height,
          greaterThanOrEqualTo(44));
    });

    testWidgets(
        'double-tapping only launches WhatsApp once (Polish pass in-flight guard)',
        (tester) async {
      final rec = _Recorder()..gate = Completer<void>();
      await _pump(tester, const ProfileScreen(), rec);

      // Both taps fire before any frame is pumped in between — the tile
      // itself hasn't yet rebuilt into its disabled state, so only
      // SupportContactTile's own in-flight guard (not the rebuilt
      // `enabled: false`) is what stops the second call.
      await tester.tap(find.byKey(_profileKey));
      await tester.tap(find.byKey(_profileKey));
      await tester.pump();
      rec.gate!.complete();
      await tester.pumpAndSettle();

      expect(rec.calls, hasLength(1));
    });
  });

  group('Order Details — contextual support action', () {
    testWidgets('opens wa.me with a message containing the order reference',
        (tester) async {
      final rec = _Recorder();
      await _pump(tester, const OrderDetailsScreen(orderId: _orderId), rec);
      await _scrollTo(tester, _orderKey);

      expect(find.text('تواصل مع Hatly بخصوص الطلب'), findsOneWidget);
      await tester.tap(find.byKey(_orderKey));
      await tester.pumpAndSettle();

      expect(rec.calls, hasLength(1));
      final text = rec.calls.single.queryParameters['text']!;
      expect(text, contains(_orderId));
      expect(text, 'مرحبًا Hatly، أحتاج إلى مساعدة بخصوص الطلب رقم $_orderId.');
      // Support message only — never the manual-transfer payment-proof wording.
      expect(text, isNot(contains('transfer proof')));
    });

    testWidgets('hidden entirely when the support number is unavailable',
        (tester) async {
      final rec = _Recorder();
      await _pump(tester, const OrderDetailsScreen(orderId: _orderId), rec,
          contact: () async => const SupportContact());
      expect(find.byKey(_orderKey),
          findsOneWidget); // the (empty) tile widget exists…
      expect(find.text('تواصل مع Hatly بخصوص الطلب'),
          findsNothing); // …but renders nothing
      expect(tester.takeException(), isNull);
    });

    testWidgets(
        'launch failure shows the localized message and leaves the order screen intact',
        (tester) async {
      final rec = _Recorder()..result = false;
      await _pump(tester, const OrderDetailsScreen(orderId: _orderId), rec);
      await _scrollTo(tester, _orderKey);
      await tester.tap(find.byKey(_orderKey));
      await tester.pumpAndSettle();
      expect(find.text('تعذّر فتح واتساب. حاول مرة أخرى.'), findsOneWidget);
      expect(find.text('تواصل مع Hatly بخصوص الطلب'), findsOneWidget);
    });

    for (final dark in [false, true]) {
      testWidgets(
          'RTL ${dark ? 'dark' : 'light'} at 2.0× text: no overflow, action reachable',
          (tester) async {
        final rec = _Recorder();
        await _pump(tester, const OrderDetailsScreen(orderId: _orderId), rec,
            dark: dark, textScale: 2.0);
        await _scrollTo(tester, _orderKey);
        expect(tester.takeException(), isNull);
        expect(find.text('تواصل مع Hatly بخصوص الطلب'), findsOneWidget);
      });
    }

    testWidgets('English locale message carries the order reference',
        (tester) async {
      final rec = _Recorder();
      await _pump(tester, const OrderDetailsScreen(orderId: _orderId), rec,
          locale: const Locale('en'));
      await _scrollTo(tester, _orderKey);
      await tester.tap(find.byKey(_orderKey));
      await tester.pumpAndSettle();
      expect(rec.calls.single.queryParameters['text'],
          'Hi Hatly, I need help with order $_orderId.');
    });
  });

  group('Manual-transfer flow stays separate', () {
    test(
        'openWhatsAppWithMessage still builds the same wa.me link with the payment-proof text',
        () {
      final message = buildTransferProofMessage(
          orderNumber: 'o-1',
          paymentMethodLabel: 'InstaPay',
          formattedAmount: 'EGP 10.00');
      final uri =
          buildWhatsAppUri(phoneNumber: '+201000000000', message: message);
      expect(uri.queryParameters['text'], message);
      expect(message, startsWith('Hatly Order #o-1'));
    });
  });
}
