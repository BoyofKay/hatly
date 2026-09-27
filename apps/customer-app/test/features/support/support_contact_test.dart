import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/core/utils/whatsapp_helper.dart';
import 'package:hatly_customer/features/support/data/support_contact_api.dart';
import 'package:hatly_customer/features/support/data/support_providers.dart';

/// Pure logic for the customer-support WhatsApp foundation: parsing the backend payload, loading it through the
/// provider, and building the wa.me URL / messages. (Widget behaviour is in support_actions_widget_test.dart.)
class _FakeSupportApi implements SupportContactApi {
  _FakeSupportApi(this._result);
  final Future<SupportContact> Function() _result;
  @override
  Future<SupportContact> getContact() => _result();
}

void main() {
  group('SupportContact.fromJson — tolerant parsing', () {
    test('parses a configured number, trimmed', () {
      final c = SupportContact.fromJson({'whatsappNumber': ' +201000000000 '});
      expect(c.whatsappNumber, '+201000000000');
      expect(c.isAvailable, true);
    });

    test(
        'null / missing / blank / non-string / digit-less → unavailable, never throws',
        () {
      for (final json in <Map<String, dynamic>>[
        {'whatsappNumber': null},
        {},
        {'whatsappNumber': ''},
        {'whatsappNumber': '   '},
        {'whatsappNumber': 201000000000},
        {'whatsappNumber': 'call us'},
      ]) {
        final c = SupportContact.fromJson(json);
        expect(c.whatsappNumber, isNull, reason: '$json');
        expect(c.isAvailable, false, reason: '$json');
      }
    });
  });

  group('supportContactProvider — loading', () {
    test('serves the number from the API', () async {
      final container = ProviderContainer(overrides: [
        supportContactApiProvider.overrideWithValue(_FakeSupportApi(
            () async => const SupportContact(whatsappNumber: '+201000000000'))),
      ]);
      addTearDown(container.dispose);
      final c = await container.read(supportContactProvider.future);
      expect(c.whatsappNumber, '+201000000000');
    });

    test(
        'a failed load (network / 4xx / 5xx) resolves to unavailable — the error never leaks to the UI',
        () async {
      final container = ProviderContainer(overrides: [
        supportContactApiProvider.overrideWithValue(_FakeSupportApi(
            () async => throw Exception('backend down: secret detail'))),
      ]);
      addTearDown(container.dispose);
      final c = await container.read(supportContactProvider.future);
      expect(c.isAvailable, false);
    });
  });

  group('buildWhatsAppUri', () {
    test('digits only, no text when there is no message', () {
      final uri = buildWhatsAppUri(phoneNumber: '+20 100-000 0000');
      expect(uri.toString(), 'https://wa.me/201000000000');
      expect(uri.queryParameters, isEmpty);
    });

    test('a blank message adds no ?text=', () {
      expect(
          buildWhatsAppUri(phoneNumber: '+201000000000', message: '   ')
              .toString(),
          'https://wa.me/201000000000');
    });

    test('an Arabic message round-trips through URL encoding', () {
      const message = 'مرحبًا Hatly، أحتاج إلى مساعدة.';
      final uri =
          buildWhatsAppUri(phoneNumber: '+201000000000', message: message);
      expect(uri.host, 'wa.me');
      expect(uri.path, '/201000000000');
      expect(uri.queryParameters['text'], message);
    });
  });

  group(
      'support messages (localized) — separate from the payment-proof message',
      () {
    Future<AppLocalizations> l10nFor(String code) =>
        AppLocalizations.delegate.load(Locale(code));

    test('general support message is concise and carries no order reference',
        () async {
      final ar = await l10nFor('ar');
      final en = await l10nFor('en');
      expect(ar.supportMessageGeneral, 'مرحبًا Hatly، أحتاج إلى مساعدة.');
      expect(en.supportMessageGeneral, 'Hi Hatly, I need some help.');
    });

    test('order support message includes the order reference (ar + en)',
        () async {
      const id = '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab';
      expect((await l10nFor('ar')).supportMessageOrder(id), contains(id));
      expect((await l10nFor('en')).supportMessageOrder(id), contains(id));
      final uri = buildWhatsAppUri(
          phoneNumber: '+201000000000',
          message: (await l10nFor('en')).supportMessageOrder(id));
      expect(uri.queryParameters['text'], contains(id));
    });

    test(
        'the payment-proof builder is unchanged and shares nothing with the support messages',
        () async {
      final proof = buildTransferProofMessage(
          orderId: 'o-1',
          paymentMethodLabel: 'InstaPay',
          formattedAmount: 'EGP 10.00');
      expect(
          proof,
          startsWith(
              'Hatly Order #o-1\nPayment method: InstaPay\nAmount: EGP 10.00'));
      expect(proof, contains('transfer proof'));
      final en = await l10nFor('en');
      expect(en.supportMessageOrder('o-1'), isNot(contains('transfer proof')));
      expect(en.supportMessageGeneral, isNot(contains('transfer proof')));
    });
  });
}
