import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/core/utils/egypt_phone_number.dart';
import 'package:hatly_customer/features/auth/presentation/widgets/egypt_phone_field.dart';

/// Regression (2026-10-26, "registered, signed in, logged out — can't sign in again"): the sign-in/registration phone field must keep
/// every way an Egyptian customer can enter the SAME number, so it always normalizes to the same E.164 the account was created with.
/// The field used to keep ASCII digits only, cut at 11 characters: `+201012345678` (typed, pasted or filled in by the phone's autofill)
/// became `20101234567` and Arabic-Indic digits vanished — the app refused the number ("phone invalid") and never even asked the server.
void main() {
  const e164 = '+201012345678';
  const variants = <String, String>{
    'local with leading 0': '01012345678',
    'national without 0': '1012345678',
    'E.164': '+201012345678',
    'E.164 with spaces (autofill / paste)': '+20 10 1234 5678',
    '00 international prefix': '00201012345678',
    'country code without +': '201012345678',
    'spaces and dashes': '010-1234-5678',
    'Arabic-Indic digits (Arabic keyboard)': '٠١٠١٢٣٤٥٦٧٨',
    'Persian digits': '۰۱۰۱۲۳۴۵۶۷۸',
    'Arabic-Indic E.164': '+٢٠١٠١٢٣٤٥٦٧٨',
  };

  Future<String> typeInto(WidgetTester tester, String input) async {
    final controller = TextEditingController();
    await tester.pumpWidget(MaterialApp(
      theme: HatlyTheme.light(),
      home: Scaffold(body: EgyptPhoneField(controller: controller, autofocus: false)),
    ));
    await tester.enterText(find.byType(TextField), input); // goes through the field's input formatters, like typing/autofill
    await tester.pump();
    return controller.text;
  }

  for (final entry in variants.entries) {
    testWidgets('field + normalizer keep the same number: ${entry.key}', (tester) async {
      final kept = await typeInto(tester, entry.value);
      expect(EgyptPhoneNumber.normalize(kept), e164, reason: 'field kept "$kept" from "${entry.value}"');
    });
  }

  for (final typed in ['+201012345678', '00201012345678', '201012345678', '01012345678', '٠١٠١٢٣٤٥٦٧٨']) {
    testWidgets('typing "$typed" one character at a time keeps the number', (tester) async {
      final controller = TextEditingController();
      await tester.pumpWidget(MaterialApp(
        theme: HatlyTheme.light(),
        home: Scaffold(body: EgyptPhoneField(controller: controller, autofocus: false)),
      ));
      var current = '';
      for (final ch in typed.split('')) {
        current = controller.text + ch;
        await tester.enterText(find.byType(TextField), current);
        await tester.pump();
      }
      expect(EgyptPhoneNumber.normalize(controller.text), e164, reason: 'field ended as "${controller.text}"');
    });
  }

  test('the normalizer itself maps every variant to the same E.164', () {
    for (final v in variants.values) {
      expect(EgyptPhoneNumber.normalize(v), e164, reason: v);
    }
  });

  test('still rejects what is not an Egyptian mobile number', () {
    for (final bad in ['', '123', '0201234567', '+201912345678', '+2010123456789', '01012345abc', '+44 20 7946 0958']) {
      expect(EgyptPhoneNumber.normalize(bad), isNull, reason: bad);
    }
  });

  group('looksInternational (only changes the MESSAGE; acceptance is unchanged)', () {
    test('another country\'s code is recognised, in ASCII and Arabic-Indic digits, with + or 00', () {
      for (final foreign in ['+966501234567', '00966501234567', '+971 50 123 4567', '+٩٦٦٥٠١٢٣٤٥٦٧', '+1 202 555 0100']) {
        expect(EgyptPhoneNumber.looksInternational(foreign), isTrue, reason: foreign);
        expect(EgyptPhoneNumber.normalize(foreign), isNull, reason: '$foreign must still be rejected');
      }
    });

    test('Egyptian shapes and bare local numbers are not "international"', () {
      for (final egypt in ['01012345678', '1012345678', '+201012345678', '+20 10 1234 5678', '00201012345678', '٠١٠١٢٣٤٥٦٧٨', '0501234567', '']) {
        expect(EgyptPhoneNumber.looksInternational(egypt), isFalse, reason: egypt);
      }
    });
  });
}
