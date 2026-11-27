import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/features/vendors/presentation/widgets/custom_request_action.dart';
import 'package:image_picker/image_picker.dart';
import 'package:hatly_customer/features/uploads/data/uploads_api.dart';
import 'package:hatly_customer/features/uploads/data/uploads_providers.dart';
import 'package:hatly_customer/shared_widgets/voice_note/voice_note_engine.dart';

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
  voiceOnlyTest();
  testWidgets('movable store entry uses the existing vendor-specific request sheet',
      (tester) async {
    await tester.pumpWidget(hatlyTestApp(
      const Scaffold(body: Center(child: CustomRequestAction(
        vendorBranchId: 'branch-1', floating: true))),
      locale: const Locale('en'),
    ));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('vendor-custom-request-bubble')), findsOneWidget);
    expect(find.text('Hatly Service'), findsOneWidget);
    await tester.tap(find.byKey(const Key('vendor-custom-request-bubble')));
    await tester.pumpAndSettle();
    expect(find.text("Request an item that isn't listed"), findsOneWidget);
  });

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
    expect(find.text("Request an item that isn't listed"), findsOneWidget);

    await tester.tap(find.byIcon(Icons.add_a_photo_outlined));
    await tester.pump();

    // Dismiss the sheet (tap the scrim above it) while the pick is still
    // pending — this disposes _CustomRequestSheetState.
    await tester.tapAt(const Offset(200, 10));
    await tester.pumpAndSettle();
    expect(find.text("Request an item that isn't listed"), findsNothing);

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

  testWidgets(
      'before tapping, the entry says what will happen; the sheet explains the flow (cart → store → price); after adding, the customer is told what happened',
      (tester) async {
    final api = _AcceptingCartApi();
    await tester.pumpWidget(hatlyTestApp(
      const Scaffold(
          body: Center(child: CustomRequestAction(vendorBranchId: 'branch-1'))),
      locale: const Locale('ar'),
      overrides: [cartApiProvider.overrideWithValue(api)],
    ));
    await tester.pumpAndSettle();
    final ar = lookupAppLocalizations(const Locale('ar'));
    expect(find.byKey(const Key('custom-request-hint')), findsOneWidget);
    expect(find.text(ar.customRequestEntryHint), findsOneWidget);

    await tester.tap(find.byIcon(Icons.help_outline));
    await tester.pumpAndSettle();
    expect(find.text(ar.customRequestSheetTitle), findsOneWidget);
    expect(find.text(ar.customRequestSheetSubtitle), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'بانادول إكسترا');
    await tester.pumpAndSettle();
    await tester.tap(find.text(l10nSubmitAr));
    await tester.pumpAndSettle();

    expect(find.text(ar.customRequestSheetTitle), findsNothing,
        reason: 'the sheet closes on success');
    expect(find.text(ar.customRequestAdded), findsOneWidget);
    expect(api.sent, ['بانادول إكسترا']);
  });

  testWidgets(
      'the server refusing a sector that does not allow custom requests is shown localized (never the English backend text) and nothing is claimed as added',
      (tester) async {
    final api = _RejectingCartApi(const ApiException(
      code: 'FORBIDDEN',
      message: 'Custom requests are not available for this vendor.',
      details: {'code': 'CUSTOM_REQUESTS_NOT_AVAILABLE'},
      statusCode: 403,
    ));
    await tester.pumpWidget(hatlyTestApp(
      const Scaffold(
          body: Center(child: CustomRequestAction(vendorBranchId: 'branch-1'))),
      locale: const Locale('ar'),
      overrides: [cartApiProvider.overrideWithValue(api)],
    ));
    await tester.pumpAndSettle();
    final ar = lookupAppLocalizations(const Locale('ar'));
    await tester.tap(find.byIcon(Icons.help_outline));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'شيء');
    await tester.pumpAndSettle();
    await tester.tap(find.text(l10nSubmitAr));
    await tester.pumpAndSettle();
    expect(find.text(ar.cartErrorCustomRequestsUnavailable), findsOneWidget);
    expect(
        find.textContaining('Custom requests are not available'), findsNothing);
    expect(find.text(ar.customRequestAdded), findsNothing);
  });
}


class _FakeVoice implements VoiceNoteEngine {
  @override
  Future<bool> ensurePermission() async => true;
  @override
  Future<void> startRecording() async {}
  @override
  Future<String?> stopRecording() async => '/tmp/v.m4a';
  @override
  Future<void> cancelRecording() async {}
  @override
  Future<void> play(String pathOrUrl, {required void Function() onDone}) async {}
  @override
  Future<void> stopPlayback() async {}
  @override
  Future<List<int>> readBytes(String path) async => List<int>.filled(10, 1);
  @override
  Future<void> dispose() async {}
}

class _FakeUploads implements UploadsApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  @override
  Future<String> uploadAudio(List<int> bytes) async => '/uploads/files/v.m4a';
}

void voiceOnlyTest() {
  testWidgets('UAT VN-02: a voice-only custom request inside a store can be sent', (tester) async {
    tester.view.physicalSize = const Size(400, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = _AcceptingCartApi();
    await tester.pumpWidget(hatlyTestApp(
      const Scaffold(body: Center(child: CustomRequestAction(vendorBranchId: 'branch-1'))),
      locale: const Locale('ar'),
      overrides: [
        cartApiProvider.overrideWithValue(api),
        uploadsApiProvider.overrideWithValue(_FakeUploads()),
        voiceNoteEngineProvider.overrideWith((ref) => _FakeVoice()),
      ],
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.help_outline));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('voice-note-record')));
    await tester.tap(find.byKey(const Key('voice-note-record')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 2));
    await tester.tap(find.byKey(const Key('voice-note-stop')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text(l10nSubmitAr));
    await tester.tap(find.text(l10nSubmitAr));
    await tester.pumpAndSettle();
    expect(api.voices, ['/uploads/files/v.m4a']);
    expect(api.sent, [null]);
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
    String? voiceNoteUrl,
  }) async {
    attempts++;
    throw error;
  }
}

/// A cart API that accepts the custom item (and records what was sent).
class _AcceptingCartApi extends FakeCartApi {
  final sent = <String?>[];
  final voices = <String?>[];

  @override
  Future<Cart> addVendorCustomItem({
    String? cartVendorGroupId,
    String? vendorBranchId,
    String? freeTextDescription,
    List<String>? imageUrls,
    String? voiceNoteUrl,
  }) async {
    sent.add(freeTextDescription);
    voices.add(voiceNoteUrl);
    return cart;
  }
}
