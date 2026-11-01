import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/auth/presentation/session_controller.dart';
import 'package:hatly_customer/features/profile/presentation/widgets/delete_account_section.dart';

import '../../support/auth_fakes.dart';
import '../../support/test_app.dart';

/// Store policy (App Store 5.1.1(v), Google Play account deletion): an in-app way to delete the account. The dialog explains what is
/// erased/kept and what blocks it BEFORE asking for the password, never sends an empty password, shows the backend's refusals in
/// the customer's language, and on success ends the session and clears the device.
void main() {
  late FakeAuthApi api;
  late FakeAuthTokenStorage storage;

  Future<void> pump(WidgetTester tester) async {
    api = FakeAuthApi();
    storage = FakeAuthTokenStorage()
      ..access = 'access-token'
      ..refresh = 'refresh-token';
    await tester.pumpWidget(hatlyTestApp(const Scaffold(body: Center(child: DeleteAccountSection())), overrides: authOverrides(api, storage)));
    await tester.pumpAndSettle();
  }

  Future<void> openDialog(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('delete-account-entry')));
    await tester.pumpAndSettle();
  }

  Future<void> confirmWith(WidgetTester tester, String password) async {
    await tester.enterText(find.descendant(of: find.byKey(const Key('delete-account-password-field')), matching: find.byType(TextField)), password);
    await tester.tap(find.byKey(const Key('delete-account-confirm')));
    await tester.pumpAndSettle();
  }

  testWidgets('the entry opens a dialog that says what is erased, what stays and what blocks deletion — before any password is asked', (tester) async {
    await pump(tester);
    await openDialog(tester);
    expect(find.text('حذف الحساب نهائيًا'), findsOneWidget);
    expect(find.textContaining('تبقى سجلات الطلبات والمدفوعات المنتهية بدون أي بيانات تعرّف بك'), findsOneWidget);
    expect(find.textContaining('لا يمكن حذف الحساب أثناء وجود طلب قيد التنفيذ'), findsOneWidget);
    expect(api.deleteAccountCalls, isEmpty);
  });

  testWidgets('Cancel closes the dialog and sends nothing', (tester) async {
    await pump(tester);
    await openDialog(tester);
    await tester.tap(find.byKey(const Key('delete-account-cancel')));
    await tester.pumpAndSettle();
    expect(find.text('حذف الحساب نهائيًا'), findsNothing);
    expect(api.deleteAccountCalls, isEmpty);
    expect(storage.access, 'access-token');
  });

  testWidgets('an empty password is stopped on the device — nothing is sent', (tester) async {
    await pump(tester);
    await openDialog(tester);
    await tester.tap(find.byKey(const Key('delete-account-confirm')));
    await tester.pumpAndSettle();
    expect(find.text('أدخل كلمة المرور لتأكيد الحذف'), findsOneWidget);
    expect(api.deleteAccountCalls, isEmpty);
  });

  testWidgets('confirming sends the password, clears the device and ends the session', (tester) async {
    await pump(tester);
    await openDialog(tester);
    await confirmWith(tester, 'my-password-1');
    expect(api.deleteAccountCalls, ['my-password-1']);
    expect(storage.access, isNull);
    expect(storage.refresh, isNull);
    final container = ProviderScope.containerOf(tester.element(find.byType(DeleteAccountSection)));
    expect(container.read(sessionControllerProvider).status, SessionStatus.unauthenticated);
    expect(find.text('حذف الحساب نهائيًا'), findsNothing); // the dialog closed
  });

  for (final scenario in <({String name, String code, int status, String message})>[
    (name: 'an order in progress', code: 'ACCOUNT_HAS_ACTIVE_ORDERS', status: 409, message: 'لديك طلب قيد التنفيذ. يمكنك حذف حسابك بعد انتهائه.'),
    (name: 'a wallet balance', code: 'ACCOUNT_HAS_WALLET_BALANCE', status: 409, message: 'محفظة هاتلي ليست فارغة. تواصل مع دعم هاتلي لتسويتها قبل حذف الحساب.'),
    (name: 'a wrong password', code: 'PASSWORD_INVALID', status: 403, message: 'كلمة المرور غير صحيحة'),
  ]) {
    testWidgets('${scenario.name}: the refusal is shown in Arabic, the dialog stays open and the session is untouched', (tester) async {
      await pump(tester);
      api.deleteAccountError = apiError('CONFLICT', businessCode: scenario.code, status: scenario.status);
      await openDialog(tester);
      await confirmWith(tester, 'my-password-1');
      expect(find.text(scenario.message), findsOneWidget);
      expect(find.text('حذف الحساب نهائيًا'), findsOneWidget);
      expect(storage.access, 'access-token');
      final container = ProviderScope.containerOf(tester.element(find.byType(DeleteAccountSection)));
      expect(container.read(sessionControllerProvider).status, isNot(SessionStatus.unauthenticated));
    });
  }

  testWidgets('a network failure shows the offline message and keeps the account', (tester) async {
    await pump(tester);
    api.deleteAccountError = apiError('NETWORK_ERROR');
    await openDialog(tester);
    await confirmWith(tester, 'my-password-1');
    expect(find.text('لا يوجد اتصال بالإنترنت. تحقق من الشبكة وحاول مرة أخرى'), findsOneWidget);
    expect(storage.access, 'access-token');
  });
}
