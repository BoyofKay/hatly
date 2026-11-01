import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/features/auth/presentation/otp_flow_controller.dart';
import 'package:hatly_customer/features/auth/presentation/screens/otp_verify_screen.dart';

/// Real OtpFlowController state machine, with the network calls recorded
/// instead of performed. The screen under test is wired to it exactly as in
/// the app. The screen is the code step of a registration (the phone is proven before the account exists).
class _RecordingFlow extends OtpFlowController {
  _RecordingFlow(super.ref, OtpFlowState initial) {
    state = initial;
  }

  final calls = <String>[];

  @override
  Future<bool> confirmPhoneVerification(String code) async {
    calls.add('verify:$code');
    return true;
  }

  @override
  Future<void> resendVerification() async => calls.add('resend');

  @override
  void skipVerification() {
    calls.add('skip');
  }
}

late _RecordingFlow _flow;

Future<void> _pump(
  WidgetTester tester, {
  OtpFlowState state = const OtpFlowState(
    step: OtpFlowStep.otpSent,
    phone: '+201012345678',
    resendCooldownSeconds: 42,
  ),
  Locale locale = const Locale('ar'),
  bool dark = false,
  double textScale = 1.0,
}) async {
  HatlyTypography.useGoogleFonts = false;
  await tester.pumpWidget(const SizedBox()); // drop any previous ProviderScope
  final router = GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(
          path: '/',
          builder: (c, s) => const Scaffold(body: Text('phone-entry'))),
      GoRoute(path: '/otp', builder: (c, s) => const OtpVerifyScreen()),
    ],
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        otpFlowControllerProvider
            .overrideWith((ref) => _flow = _RecordingFlow(ref, state)),
      ],
      child: MaterialApp.router(
        routerConfig: router,
        theme: HatlyTheme.light(),
        darkTheme: HatlyTheme.dark(),
        themeMode: dark ? ThemeMode.dark : ThemeMode.light,
        locale: locale,
        supportedLocales: const [Locale('ar'), Locale('en')],
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        builder: (context, w) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(textScale)),
          child: w!,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  // '/' stays underneath so pop() has somewhere to go, as in the real flow
  router.push('/otp');
  await tester.pumpAndSettle();
}

void main() {
  test(
      'phone is masked for display but keeps its first/last digits, wrapped in LTR isolates',
      () {
    expect(maskPhoneForDisplay('+201012345678'), '\u2066+2010•••••678\u2069');
    expect(maskPhoneForDisplay('123'), '\u2066123\u2069');
  });

  testWidgets(
      'shows the heading, the MASKED number (never the full one), 6 boxes, resend timer and a disabled CTA',
      (tester) async {
    await _pump(tester);
    expect(find.text('أدخل رمز التحقق'), findsOneWidget);
    expect(find.textContaining('+2010•••••678'), findsOneWidget);
    expect(find.textContaining('+201012345678'), findsNothing);
    expect(find.text('تغيير رقم الهاتف'),
        findsOneWidget); // backing out cancels the registration
    expect(find.text('ليس الآن'),
        findsNothing); // there is no "continue unverified": no account exists yet
    expect(find.text('إعادة الإرسال خلال 42 ثانية'), findsOneWidget);
    expect(find.text('إعادة إرسال الرمز'), findsNothing);
    final button = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
    expect(button.onPressed, isNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'typing fills the boxes; the CTA enables at 6 digits and verifies with that code (existing behaviour)',
      (tester) async {
    await _pump(tester);
    await tester.enterText(find.byType(TextField), '12345');
    await tester.pump();
    expect(tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
        isNull);
    expect(_flow.calls, isEmpty);

    await tester.enterText(find.byType(TextField), '123456');
    await tester.pump();
    // auto-verify on completion (existing onCompleted behaviour)
    expect(_flow.calls, ['verify:123456']);
    await tester.tap(find.byType(ElevatedButton));
    expect(_flow.calls, ['verify:123456', 'verify:123456']);
  });

  testWidgets(
      'the active box is orange, the others neutral; an error turns the boxes red and shows the notice with an icon',
      (tester) async {
    await _pump(tester);
    Color? border(int i) {
      final boxes = tester
          .widgetList<Container>(find.descendant(
              of: find.byType(Row), matching: find.byType(Container)))
          .where((c) => c.constraints?.maxHeight == 56)
          .toList();
      return ((boxes[i].decoration as BoxDecoration).border as Border)
          .top
          .color;
    }

    expect(border(0), HatlyColors.primaryOrange);
    expect(border(1), HatlyPalette.light.border);

    await _pump(tester,
        state: const OtpFlowState(
            step: OtpFlowStep.otpSent,
            phone: '+201012345678',
            errorCode: 'INVALID_OTP'));
    expect(border(0), HatlyPalette.light.urgent);
    expect(find.byIcon(Icons.error_outline_rounded), findsOneWidget);
  });

  testWidgets(
      'resend: while cooling down there is a timer and no button; at 0 the resend action appears and calls resendVerification',
      (tester) async {
    await _pump(tester,
        state: const OtpFlowState(
            step: OtpFlowStep.otpSent,
            phone: '+201012345678',
            resendCooldownSeconds: 0));
    expect(find.textContaining('إعادة الإرسال خلال'), findsNothing);
    await tester.tap(find.text('إعادة إرسال الرمز'));
    expect(_flow.calls, ['resend']);
  });

  testWidgets(
      '"Change phone number" and the back button both cancel the registration (no account exists to continue into)',
      (tester) async {
    await _pump(tester);
    await tester.tap(find.text('تغيير رقم الهاتف'));
    await tester.pump();
    expect(_flow.calls, ['skip']);

    await _pump(tester);
    await tester.tap(find.byType(BackButton));
    await tester.pump();
    expect(_flow.calls, ['skip']);
  });

  testWidgets(
      'the system back gesture also cancels instead of popping or trapping the customer',
      (tester) async {
    await _pump(tester);
    await tester.binding.handlePopRoute();
    await tester.pump();
    expect(_flow.calls, ['skip']);
    expect(find.byType(OtpVerifyScreen), findsOneWidget);
  });

  testWidgets('touch targets: resend/skip actions are at least 44px tall',
      (tester) async {
    await _pump(tester,
        state: const OtpFlowState(
            step: OtpFlowStep.otpSent, phone: '+201012345678'));
    for (final label in ['تغيير رقم الهاتف', 'إعادة إرسال الرمز']) {
      final h = tester
          .getSize(find
              .ancestor(of: find.text(label), matching: find.byType(TextButton))
              .first)
          .height;
      expect(h, greaterThanOrEqualTo(44), reason: label);
    }
  });

  for (final s in const [
    ('ar light 390', Locale('ar'), false, 390.0, 1.0),
    ('en dark 390', Locale('en'), true, 390.0, 1.0),
    ('ar dark 320 large text', Locale('ar'), true, 320.0, 1.6),
  ]) {
    testWidgets('no overflow: ${s.$1}', (tester) async {
      tester.view.physicalSize = Size(s.$4, 560);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await _pump(tester,
          locale: s.$2,
          dark: s.$3,
          textScale: s.$5,
          state: const OtpFlowState(
              step: OtpFlowStep.otpSent,
              phone: '+201012345678',
              resendCooldownSeconds: 30,
              errorCode: 'INVALID_OTP'));
      expect(tester.takeException(), isNull);
    });
  }
}
