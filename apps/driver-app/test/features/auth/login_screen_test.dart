import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/features/auth/presentation/login_screen.dart';
import 'package:hatly_driver/features/overview/overview_api.dart';

class _FakeOverview implements OverviewApi {
  final resetRequests = <String>[];
  @override
  Future<void> requestPasswordReset(String phone) async => resetRequests.add(phone);
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError();
}

/// Owner request 2026-11-22: the driver can show / hide the password, and "Forgot password?" explains that Hatly operations set a
/// temporary password (there is no SMS reset yet).
void main() {
  Future<void> pump(WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const ProviderScope(child: MaterialApp(home: LoginScreen())));
    await tester.pumpAndSettle();
  }

  bool obscured(WidgetTester tester) =>
      tester.widget<TextField>(find.byKey(const Key('login-password'))).obscureText;

  testWidgets('the eye button shows and hides the password', (tester) async {
    await pump(tester);
    await tester.enterText(find.byKey(const Key('login-password')), 'secret-123');
    expect(obscured(tester), isTrue);
    await tester.tap(find.byKey(const Key('toggle-password')));
    await tester.pump();
    expect(obscured(tester), isFalse);
    await tester.tap(find.byKey(const Key('toggle-password')));
    await tester.pump();
    expect(obscured(tester), isTrue);
  });

  testWidgets('"Forgot password?" sends a request to Operations with the phone typed', (tester) async {
    final api = _FakeOverview();
    tester.view.physicalSize = const Size(390, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ProviderScope(overrides: [overviewApiProvider.overrideWithValue(api)], child: const MaterialApp(home: LoginScreen())));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('forgot-password')));
    await tester.pumpAndSettle();
    expect(find.textContaining('temporary password'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('forgot-phone')), '+201000000123');
    await tester.tap(find.byKey(const Key('forgot-send')));
    await tester.pumpAndSettle();
    expect(api.resetRequests, ['+201000000123']);
    expect(find.byKey(const Key('forgot-sent')), findsOneWidget);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
  });
}
