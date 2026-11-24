import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/auth/presentation/screens/phone_entry_screen.dart';
import 'package:hatly_customer/features/auth/presentation/widgets/egypt_phone_field.dart';

import '../../support/test_app.dart';

void main() {
  testWidgets('sign-in password visibility is off initially and toggles independently', (tester) async {
    await tester.pumpWidget(hatlyTestApp(const PhoneEntryScreen()));
    final password = find.byType(TextField).at(1);
    expect(tester.widget<TextField>(password).obscureText, isTrue);
    await tester.tap(find.byKey(const Key('entry-password-visibility')));
    await tester.pump();
    expect(tester.widget<TextField>(password).obscureText, isFalse);
    await tester.tap(find.byKey(const Key('entry-password-visibility')));
    await tester.pump();
    expect(tester.widget<TextField>(password).obscureText, isTrue);
  });

  testWidgets('renders the redesigned form with the existing Arabic content',
      (tester) async {
    await tester.pumpWidget(hatlyTestApp(const PhoneEntryScreen()));
    await tester.pump();

    expect(find.text('مرحبًا بك في هاتلي'), findsOneWidget);
    expect(find.text('أدخل رقم هاتفك للمتابعة'), findsOneWidget);
    expect(find.text('رقم الهاتف'), findsOneWidget);
    expect(find.text('+20'), findsOneWidget);
    expect(find.text('متابعة'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'validation behaviour is unchanged: empty submit shows the phone error, in the new notice',
      (tester) async {
    await tester.pumpWidget(hatlyTestApp(const PhoneEntryScreen()));
    await tester.tap(find.text('متابعة'));
    await tester.pump();
    expect(find.byIcon(Icons.error_outline_rounded), findsOneWidget);
    expect(find.textContaining('رقم'), findsWidgets);
  });

  testWidgets(
      'phone field still accepts digits only, max 11, and keeps a fixed +20 prefix',
      (tester) async {
    final controller = TextEditingController();
    await tester.pumpWidget(hatlyTestApp(
        EgyptPhoneField(controller: controller, autofocus: false)));
    await tester.enterText(find.byType(TextField), '01a0-12345678999');
    expect(controller.text, '01012345678');
    expect(find.text('+20'), findsOneWidget);
  });

  testWidgets(
      'fits a 320px screen with large text, in dark mode, and scrolls instead of overflowing',
      (tester) async {
    tester.view.physicalSize = const Size(320, 480);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
        hatlyTestApp(const PhoneEntryScreen(), dark: true, textScale: 1.6));
    await tester.pump();
    expect(tester.takeException(), isNull);
  });
}
