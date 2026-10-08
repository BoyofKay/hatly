import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/features/vendors/presentation/widgets/custom_request_action.dart';
import 'package:image_picker/image_picker.dart';

import '../../support/checkout_fakes.dart';
import '../../support/test_app.dart';

/// Polish pass regression: `_pickImage` used to call `setState` without a
/// `mounted` guard — if the sheet was dismissed while the OS image picker
/// was still open, the picker's result would land on an already-disposed
/// widget and throw. This exercises exactly that race using the sheet's
/// `pickImageOverride` test hook (same pattern as HatlyServiceScreen's own
/// `pickImageOverride`) to hold the "pick" open until after the sheet is
/// gone.
/// "إرسال الطلب" — read from the localizations so the test follows the app's own wording.
final String l10nSubmitAr =
    lookupAppLocalizations(const Locale('ar')).customRequestSubmit;

void main() {
  testWidgets(
      'dismissing the sheet while an image pick is still in flight never throws (mounted guard)',
      (tester) async {
    final gate = Completer<XFile?>();
    await tester.pumpWidget(hatlyTestApp(
      CustomRequestAction(
        vendorBranchId: 'branch-1',
        pickImageOverride: () => gate.future,
      ),
      locale: const Locale('en'),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text("Can't find what you're looking for?"));
    await tester.pumpAndSettle();
    expect(find.text('Request a custom item'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.add_a_photo_outlined));
    await tester.pump();

    // Dismiss the sheet (tap the scrim above it) while the pick is still
    // pending — this disposes _CustomRequestSheetState.
    await tester.tapAt(const Offset(200, 10));
    await tester.pumpAndSettle();
    expect(find.text('Request a custom item'), findsNothing);

    // The OS picker "returns" only now, after the sheet is already gone.
    gate.complete(XFile('fake/path/photo.jpg'));
    await tester.pump();
    await tester.pump();

    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'a known cart rejection is shown in ARABIC (localized) — never the backend\'s English text',
      (tester) async {
    final api = _RejectingCartApi(const ApiException(
      code: 'CONFLICT',
      message:
          'A cart cannot contain both registered-vendor items and Hatly Service items. Clear your cart to switch.',
      details: {'code': 'CATALOG_AD_HOC_MIX_NOT_ALLOWED'},
      statusCode: 409,
    ));
    await tester.pumpWidget(hatlyTestApp(
      const CustomRequestAction(vendorBranchId: 'branch-1'),
      locale: const Locale('ar'),
      overrides: [cartApiProvider.overrideWithValue(api)],
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.help_outline));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'علبة دواء محددة');
    await tester.pumpAndSettle();
    await tester.tap(find.text(l10nSubmitAr));
    await tester.pumpAndSettle();

    expect(api.attempts, 1);
    expect(
        find.text(
            'لا يمكن الجمع بين منتجات المتاجر وطلبات خدمة هاتلي في سلة واحدة. امسح السلة للتبديل بينهما.'),
        findsOneWidget);
    expect(find.textContaining('A cart cannot contain'), findsNothing);
  });
}

/// A cart API whose custom-item add is rejected with a fixed backend error.
class _RejectingCartApi extends FakeCartApi {
  _RejectingCartApi(this.error);

  final ApiException error;
  int attempts = 0;

  @override
  Future<Cart> addVendorCustomItem({
    String? cartVendorGroupId,
    String? vendorBranchId,
    String? freeTextDescription,
    List<String>? imageUrls,
  }) async {
    attempts++;
    throw error;
  }
}
