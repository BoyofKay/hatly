import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/addresses/data/addresses_providers.dart';
import 'package:hatly_customer/features/cart/data/cart_api.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';
import 'package:hatly_customer/features/hatly_service/presentation/hatly_service_screen.dart';
import 'package:hatly_customer/features/uploads/data/uploads_api.dart';
import 'package:hatly_customer/features/uploads/data/uploads_providers.dart';
import 'package:hatly_customer/core/location/device_location_service.dart';

import '../../support/router_test_app.dart';

/// Standalone Hatly Service — CONFIRMED distinct from, and never
/// exercising, the Vendor/Pharmacy Custom Request
/// (`addVendorCustomItem`); every test below only ever asserts on
/// `_FakeCartApi.addAdHocItem` calls.
///
/// No network/mocking library exists in this project (see
/// cart_model_test.dart's own comment) — `implements CartApi` /
/// `implements UploadsApi` fakes, mirroring cart_screen_test.dart's
/// established `_FakeCartApi` pattern exactly (Dart's implicit
/// interfaces mean the real classes' private fields never need to be
/// satisfied here).
class _FakeCartApi implements CartApi {
  _FakeCartApi({List<CartGroup> initialGroups = const []})
      : groups = initialGroups;

  List<CartGroup> groups;
  final List<Map<String, dynamic>> addAdHocCalls = [];
  ApiException? failNextAddAdHoc;

  /// Held open to simulate real network latency: a second tap fired
  /// while the first call is still in flight must be blocked by the
  /// screen's own `_isSubmitting` guard, not by this fake resolving
  /// too fast to observe the race at all.
  Completer<void>? gate;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  Cart _cart() => Cart(
        id: 'cart-1',
        fulfillmentType: 'DELIVERY',
        groups: groups,
        subtotalMinor: 0,
        hasUnpricedItems: groups.any((g) => g.isAdHocService),
        readyForCheckout: groups.isNotEmpty,
      );

  @override
  Future<Cart> getCart() async => _cart();

  @override
  Future<Cart> addAdHocItem({
    String? cartVendorGroupId,
    String? adHocPlaceName,
    String? adHocServiceType,
    double? pickupLatitude,
    double? pickupLongitude,
    double? destinationLatitude,
    double? destinationLongitude,
    required String freeTextDescription,
    required int quantity,
    List<String>? imageUrls,
  }) async {
    if (gate != null) await gate!.future;
    addAdHocCalls.add({
      'cartVendorGroupId': cartVendorGroupId,
      'adHocPlaceName': adHocPlaceName,
      'adHocServiceType': adHocServiceType,
      'pickupLatitude': pickupLatitude,
      'pickupLongitude': pickupLongitude,
      'destinationLatitude': destinationLatitude,
      'destinationLongitude': destinationLongitude,
      'freeTextDescription': freeTextDescription,
      'quantity': quantity,
      'imageUrls': imageUrls,
    });
    if (failNextAddAdHoc != null) {
      final e = failNextAddAdHoc!;
      failNextAddAdHoc = null;
      throw e;
    }
    final groupId = cartVendorGroupId ?? 'group-new';
    final newItem = CartItem(
      id: 'item-${addAdHocCalls.length}',
      quantity: quantity,
      selectedOptionValues: const [],
      isAvailable: true,
      freeTextDescription: freeTextDescription,
      imageUrls: imageUrls ?? const [],
    );
    if (cartVendorGroupId == null) {
      groups = [
        ...groups,
        CartGroup(
          id: groupId,
          groupType: 'AD_HOC_SERVICE',
          adHocPlaceName: adHocPlaceName,
          adHocServiceType: adHocServiceType,
          adHocPickupLatitude: pickupLatitude,
          adHocPickupLongitude: pickupLongitude,
          adHocDestinationLatitude: destinationLatitude,
          adHocDestinationLongitude: destinationLongitude,
          items: [newItem],
        ),
      ];
    } else {
      groups = [
        for (final g in groups)
          if (g.id == groupId)
            CartGroup(
              id: g.id,
              groupType: g.groupType,
              adHocPlaceName: g.adHocPlaceName,
              adHocServiceType: g.adHocServiceType,
              adHocPickupLatitude: g.adHocPickupLatitude,
              adHocPickupLongitude: g.adHocPickupLongitude,
              adHocDestinationLatitude: g.adHocDestinationLatitude,
              adHocDestinationLongitude: g.adHocDestinationLongitude,
              items: [...g.items, newItem],
            )
          else
            g,
      ];
    }
    return _cart();
  }
}

class _FakeUploadsApi implements UploadsApi {
  int callCount = 0;
  bool failNextUpload = false;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<String> uploadImage(List<int> bytes, String filename) async {
    callCount++;
    if (failNextUpload) {
      failNextUpload = false;
      throw Exception('upload failed');
    }
    return 'https://uploads.test/$filename';
  }
}

/// A real temp file so `Image.file(File(path))` in the widget under
/// test has something real to read — a bare fake `XFile` path would
/// make the image widget report a (harmless but noisy) load error.
XFile _fakeImage(String name) {
  const onePixelPng = [
    0x89,
    0x50,
    0x4E,
    0x47,
    0x0D,
    0x0A,
    0x1A,
    0x0A,
    0x00,
    0x00,
    0x00,
    0x0D,
    0x49,
    0x48,
    0x44,
    0x52,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x01,
    0x08,
    0x06,
    0x00,
    0x00,
    0x00,
    0x1F,
    0x15,
    0xC4,
    0x89,
    0x00,
    0x00,
    0x00,
    0x0A,
    0x49,
    0x44,
    0x41,
    0x54,
    0x78,
    0x9C,
    0x63,
    0x00,
    0x01,
    0x00,
    0x00,
    0x05,
    0x00,
    0x01,
    0x0D,
    0x0A,
    0x2D,
    0xB4,
    0x00,
    0x00,
    0x00,
    0x00,
    0x49,
    0x45,
    0x4E,
    0x44,
    0xAE,
    0x42,
    0x60,
    0x82,
  ];
  final file =
      File('${Directory.systemTemp.path}/hatly_service_test_$name.png');
  file.writeAsBytesSync(onePixelPng);
  return XFile(file.path);
}

/// Consolidated customer-commerce milestone (Part B — Hatly Service
/// location semantics fix): fixed at a real point so a test can drive
/// the DELIVER_TO_PLACE destination picker's "use current location"
/// button — same mechanism `address_form_test.dart` already
/// established for `AddressPinPicker`.
class _FakeLocation implements DeviceLocationService {
  const _FakeLocation();

  @override
  Future<DeviceLocationResult> getCurrentLocation() async =>
      const DeviceLocationResult(latitude: 30.42, longitude: 31.56);

  @override
  Future<bool> openAppSettings() async => true;
}

/// Taps the destination picker's "use current location" button — the
/// one way this test suite sets a real destination for DELIVER_TO_PLACE
/// without driving an actual (unavailable in tests) Google Map.
Future<void> _setDestination(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('address-use-current-location')));
  await _settle(tester);
}

/// Sets the customer's chosen place for whichever picker is showing (BUY_FROM_PLACE's pickup or DELIVER_TO_PLACE's destination —
/// both are the same `AddressPinPicker`).
Future<void> _setPlace(WidgetTester tester) => _setDestination(tester);

Widget _app({
  required _FakeCartApi cartApi,
  required _FakeUploadsApi uploadsApi,
  List<XFile>? imagesToPick,
  List<String>? visited,
}) {
  var pickIndex = 0;
  return hatlyRouterApp(
    overrides: [
      cartApiProvider.overrideWithValue(cartApi),
      uploadsApiProvider.overrideWithValue(uploadsApi),
      deviceLocationServiceProvider.overrideWithValue(const _FakeLocation()),
    ],
    initialLocation: '/hatly-service',
    routes: [
      GoRoute(
        path: '/hatly-service',
        builder: (context, state) => HatlyServiceScreen(
          pickImageOverride: imagesToPick == null
              ? null
              : () async {
                  if (pickIndex >= imagesToPick.length) return null;
                  return imagesToPick[pickIndex++];
                },
        ),
      ),
      probeRoute('/cart', visited: visited),
    ],
  );
}

Future<void> _settle(WidgetTester tester) =>
    tester.pumpAndSettle(const Duration(milliseconds: 100));

/// A tall viewport (mirrors catalog_screens_test.dart's own `_phone()`
/// helper) — this screen's form is a single scrollable column with
/// several sections, and `find.byKey`'s default `skipOffstage: true`
/// treats content clipped outside a Scrollable's current viewport as
/// not found at all, not merely "not visible yet".
void _tallViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 3000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  group('HatlyServiceScreen — service type & field visibility', () {
    testWidgets(
        'BUY_FROM_PLACE shows a pickup-location picker, not a destination one',
        (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      await tester
          .pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi()));
      await _settle(tester);

      await tester.tap(find.byKey(const Key('hatly-service-type-buy')));
      await _settle(tester);

      expect(
          find.byKey(const Key('hatly-service-pickup-picker')), findsOneWidget);
      expect(find.byKey(const Key('hatly-service-destination-picker')),
          findsNothing);
    });

    testWidgets(
        'DELIVER_TO_PLACE shows a destination-location picker, not a pickup one',
        (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      await tester
          .pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi()));
      await _settle(tester);

      await tester.tap(find.byKey(const Key('hatly-service-type-deliver')));
      await _settle(tester);

      expect(find.byKey(const Key('hatly-service-destination-picker')),
          findsOneWidget);
      expect(
          find.byKey(const Key('hatly-service-pickup-picker')), findsNothing);
    });
  });

  group('HatlyServiceScreen — validation', () {
    testWidgets(
        'Continue is disabled until a type, a place name and a description are all set',
        (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      await tester
          .pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi()));
      await _settle(tester);

      ElevatedButton continueButton() =>
          tester.widget<ElevatedButton>(find.byType(ElevatedButton).first);
      expect(continueButton().onPressed, isNull, reason: 'nothing set yet');

      await tester.tap(find.byKey(const Key('hatly-service-type-buy')));
      await _settle(tester);
      expect(continueButton().onPressed, isNull,
          reason: 'place name/description still empty');

      await tester.enterText(
          find.byKey(const Key('hatly-service-place-name')), 'Carrefour');
      await tester.enterText(
          find.byKey(const Key('hatly-service-description')), 'اشترى لي شاي');
      await _settle(tester);
      expect(continueButton().onPressed, isNull,
          reason: 'BUY_FROM_PLACE also needs the place\'s location');

      await _setPlace(tester);
      await _settle(tester);
      expect(continueButton().onPressed, isNotNull);
    });

    testWidgets(
        'the review step shows the location as set and never mentions a Hatly default location',
        (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      await tester
          .pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi()));
      await _settle(tester);

      for (final type in [
        'hatly-service-type-buy',
        'hatly-service-type-deliver'
      ]) {
        await tester.tap(find.byKey(Key(type)));
        await tester.enterText(
            find.byKey(const Key('hatly-service-place-name')), 'Somewhere');
        await tester.enterText(
            find.byKey(const Key('hatly-service-description')), 'شيء ما');
        await _setPlace(tester);
        await _settle(tester);
        await tester.tap(find.byType(ElevatedButton).first); // -> review
        await _settle(tester);

        expect(find.byKey(const Key('hatly-service-review')), findsOneWidget);
        expect(find.textContaining('الافتراضي'), findsNothing);
        expect(find.textContaining('default'), findsNothing);

        await tester.tap(find.byKey(const Key('hatly-service-edit')));
        await _settle(tester);
      }
    });

    testWidgets(
        'a text-only request (no images) is a valid, submittable request',
        (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      await tester
          .pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi()));
      await _settle(tester);

      await tester.tap(find.byKey(const Key('hatly-service-type-deliver')));
      await tester.enterText(
          find.byKey(const Key('hatly-service-place-name')), "Mom's house");
      await tester.enterText(
          find.byKey(const Key('hatly-service-description')), 'وصل الشنطة دي');
      await _setDestination(
          tester); // Part B: destination is now required for DELIVER_TO_PLACE
      await _settle(tester);
      await tester.tap(find.byType(ElevatedButton).first); // -> review
      await _settle(tester);

      expect(find.byKey(const Key('hatly-service-review')), findsOneWidget);
    });

    // Hatly Service location rule: the customer's own place is REQUIRED for both types (BUY_FROM_PLACE pickup, DELIVER_TO_PLACE
    // destination) — Hatly's configured default location is never a stand-in. See `checkout-planner.service.ts`'s
    // `resolveAdHocLocations` for the backend half. This Flutter-side gate prevents the customer from ever reaching a submission
    // the backend would reject anyway.
    testWidgets(
        'DELIVER_TO_PLACE: Continue stays disabled until a destination is also set',
        (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      await tester
          .pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi()));
      await _settle(tester);

      ElevatedButton continueButton() =>
          tester.widget<ElevatedButton>(find.byType(ElevatedButton).first);

      await tester.tap(find.byKey(const Key('hatly-service-type-deliver')));
      await tester.enterText(
          find.byKey(const Key('hatly-service-place-name')), "Mom's house");
      await tester.enterText(
          find.byKey(const Key('hatly-service-description')), 'وصل الشنطة دي');
      await _settle(tester);
      expect(continueButton().onPressed, isNull,
          reason:
              'type, place name and description are set, but no destination yet');

      await _setDestination(tester);
      await _settle(tester);
      expect(continueButton().onPressed, isNotNull);
    });

    testWidgets(
        'BUY_FROM_PLACE: Continue stays disabled until the pickup place is set — a missing pickup is never silently defaulted to Hatly\'s location',
        (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      await tester
          .pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi()));
      await _settle(tester);

      await tester.tap(find.byKey(const Key('hatly-service-type-buy')));
      await tester.enterText(
          find.byKey(const Key('hatly-service-place-name')), 'Carrefour');
      await tester.enterText(
          find.byKey(const Key('hatly-service-description')), 'اشترى لي شاي');
      await _settle(tester);

      ElevatedButton continueButton() =>
          tester.widget<ElevatedButton>(find.byType(ElevatedButton).first);
      expect(continueButton().onPressed, isNull);
      // Nothing is submitted by tapping a disabled button.
      await tester.tap(find.byType(ElevatedButton).first, warnIfMissed: false);
      await _settle(tester);
      expect(find.byKey(const Key('hatly-service-review')), findsNothing);
      expect(cartApi.addAdHocCalls, isEmpty);

      await _setPlace(tester);
      await _settle(tester);
      expect(continueButton().onPressed, isNotNull);
    });
  });

  group('HatlyServiceScreen — images', () {
    testWidgets(
        'adding 1 then 2 images shows both previews; the add button then hides (a 3rd is never offered)',
        (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      final img1 = _fakeImage('a');
      final img2 = _fakeImage('b');
      await tester.pumpWidget(_app(
          cartApi: cartApi,
          uploadsApi: _FakeUploadsApi(),
          imagesToPick: [img1, img2]));
      await _settle(tester);

      await tester.tap(find.byKey(const Key('hatly-service-add-image')));
      await _settle(tester);
      expect(find.byKey(const Key('hatly-service-remove-image-0')),
          findsOneWidget);
      expect(find.byKey(const Key('hatly-service-add-image')), findsOneWidget);

      await tester.tap(find.byKey(const Key('hatly-service-add-image')));
      await _settle(tester);
      expect(find.byKey(const Key('hatly-service-remove-image-0')),
          findsOneWidget);
      expect(find.byKey(const Key('hatly-service-remove-image-1')),
          findsOneWidget);
      // The cap is reached — the add-image tile is no longer offered at all.
      expect(find.byKey(const Key('hatly-service-add-image')), findsNothing);
    });

    testWidgets('removing an image takes it out of the selection',
        (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      final img1 = _fakeImage('c');
      await tester.pumpWidget(_app(
          cartApi: cartApi,
          uploadsApi: _FakeUploadsApi(),
          imagesToPick: [img1]));
      await _settle(tester);

      await tester.tap(find.byKey(const Key('hatly-service-add-image')));
      await _settle(tester);
      expect(find.byKey(const Key('hatly-service-remove-image-0')),
          findsOneWidget);

      await tester.tap(find.byKey(const Key('hatly-service-remove-image-0')));
      await _settle(tester);
      expect(
          find.byKey(const Key('hatly-service-remove-image-0')), findsNothing);
      // The add-image tile reappears now that there is room again.
      expect(find.byKey(const Key('hatly-service-add-image')), findsOneWidget);
    });
  });

  group('HatlyServiceScreen — submission payload per service type', () {
    Future<void> fillAndReview(WidgetTester tester,
        {required String typeKey,
        required String placeName,
        required String description}) async {
      await tester.tap(find.byKey(Key(typeKey)));
      await tester.enterText(
          find.byKey(const Key('hatly-service-place-name')), placeName);
      await tester.enterText(
          find.byKey(const Key('hatly-service-description')), description);
      await _settle(tester);
      // Both types require the customer's own place before Continue is enabled.
      await _setPlace(tester);
      await _settle(tester);
      await tester.tap(find.byType(ElevatedButton).first); // -> review
      await _settle(tester);
    }

    testWidgets(
        'BUY_FROM_PLACE submits the customer\'s chosen pickup place and no destination coordinates',
        (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      final visited = <String>[];
      await tester.pumpWidget(_app(
          cartApi: cartApi, uploadsApi: _FakeUploadsApi(), visited: visited));
      await _settle(tester);

      await fillAndReview(tester,
          typeKey: 'hatly-service-type-buy',
          placeName: 'Carrefour',
          description: 'اشترى لي شاي ليبتون');

      await tester.tap(find.byType(ElevatedButton).first); // Add to cart
      await _settle(tester);

      expect(cartApi.addAdHocCalls, hasLength(1));
      final call = cartApi.addAdHocCalls.single;
      expect(call['adHocServiceType'], 'BUY_FROM_PLACE');
      expect(call['adHocPlaceName'], 'Carrefour');
      expect(call['freeTextDescription'], 'اشترى لي شاي ليبتون');
      // The pickup is the customer's own chosen place — sent explicitly, never left for a backend default.
      expect(call['pickupLatitude'], 30.42);
      expect(call['pickupLongitude'], 31.56);
      expect(call['destinationLatitude'], isNull);
      expect(call['destinationLongitude'], isNull);
      expect(visited, contains('/cart'));
    });

    testWidgets(
        'DELIVER_TO_PLACE submits adHocServiceType=DELIVER_TO_PLACE with no pickup coordinates',
        (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      await tester
          .pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi()));
      await _settle(tester);

      await fillAndReview(tester,
          typeKey: 'hatly-service-type-deliver',
          placeName: "Mom's house",
          description: 'وصل الشنطة دي بسرعة');

      await tester.tap(find.byType(ElevatedButton).first);
      await _settle(tester);

      expect(cartApi.addAdHocCalls, hasLength(1));
      final call = cartApi.addAdHocCalls.single;
      expect(call['adHocServiceType'], 'DELIVER_TO_PLACE');
      expect(call['pickupLatitude'], isNull);
      expect(call['pickupLongitude'], isNull);
      // Part B: the destination is no longer optional — it must actually
      // be sent, never silently left for the backend to default.
      expect(call['destinationLatitude'], 30.42);
      expect(call['destinationLongitude'], 31.56);
    });

    testWidgets('double-tapping "Add to cart" only submits once',
        (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi()..gate = Completer<void>();
      await tester
          .pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi()));
      await _settle(tester);

      await fillAndReview(tester,
          typeKey: 'hatly-service-type-buy',
          placeName: 'Carrefour',
          description: 'طلب تجريبي');

      final submitButton = find.byType(ElevatedButton).first;
      // The first tap's call is held open by the gate — a second tap
      // fired while it is still in flight must be a no-op, exactly as
      // a rapid double-tap on a real (slow) network call would be.
      await tester.tap(submitButton);
      await tester.pump();
      await tester.tap(submitButton); // fires before the first completes
      await tester.pump();
      cartApi.gate!.complete();
      await _settle(tester);

      expect(cartApi.addAdHocCalls, hasLength(1));
    });
  });

  group('HatlyServiceScreen — image upload failure & retry', () {
    testWidgets(
        'an upload failure keeps the description text and the selected image, and shows an error',
        (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      final uploadsApi = _FakeUploadsApi()..failNextUpload = true;
      final img = _fakeImage('d');
      await tester.pumpWidget(
          _app(cartApi: cartApi, uploadsApi: uploadsApi, imagesToPick: [img]));
      await _settle(tester);

      await tester.tap(find.byKey(const Key('hatly-service-type-buy')));
      await tester.enterText(
          find.byKey(const Key('hatly-service-place-name')), 'Carrefour');
      await tester.enterText(find.byKey(const Key('hatly-service-description')),
          'وصف مهم لا يجب أن يضيع');
      await _setPlace(tester);
      await tester.tap(find.byKey(const Key('hatly-service-add-image')));
      await _settle(tester);
      await tester.tap(find.byType(ElevatedButton).first); // -> review
      await _settle(tester);

      // Real `dart:io` file reads (the image upload path) don't
      // resolve under `testWidgets`' fake-async zone unless run
      // through `runAsync`. `tap()` itself only awaits the SYNCHRONOUS
      // part of `onPressed`, so the rest of `_submit`'s continuation
      // (everything after the file read) keeps running in that same
      // real zone after `tap()` returns — a short real delay inside
      // `runAsync` lets it actually finish before the fake-zone pump
      // below rebuilds the tree to reflect it.
      await tester.runAsync(() async {
        await tester
            .tap(find.byType(ElevatedButton).first); // submit -> upload fails
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pump();

      expect(find.byKey(const Key('hatly-service-error')), findsOneWidget);
      expect(cartApi.addAdHocCalls, isEmpty,
          reason:
              'the cart mutation must never be called when an image upload failed');

      // Retry: go back, the text/image must still be there.
      await tester.tap(find.byKey(const Key('hatly-service-edit')));
      await _settle(tester);
      expect(find.text('وصف مهم لا يجب أن يضيع'), findsOneWidget);
      expect(find.byKey(const Key('hatly-service-remove-image-0')),
          findsOneWidget);

      // Retry submit — this time the upload succeeds.
      await tester.tap(find.byType(ElevatedButton).first); // -> review again
      await _settle(tester);
      await tester.runAsync(() async {
        await tester.tap(find.byType(ElevatedButton).first); // submit again
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pump();

      expect(cartApi.addAdHocCalls, hasLength(1));
    });
  });

  group('HatlyServiceScreen — adding to an existing Hatly Service group', () {
    testWidgets(
        'when the cart already has an AD_HOC_SERVICE group, the type/place-name/location fields are hidden and the existing group id is reused',
        (tester) async {
      _tallViewport(tester);
      const existing = CartGroup(
        id: 'existing-group',
        groupType: 'AD_HOC_SERVICE',
        adHocPlaceName: 'Carrefour',
        adHocServiceType: 'BUY_FROM_PLACE',
        items: [],
      );
      final cartApi = _FakeCartApi(initialGroups: [existing]);
      await tester
          .pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi()));
      await _settle(tester);

      expect(find.byKey(const Key('hatly-service-existing-group-notice')),
          findsOneWidget);
      expect(find.byKey(const Key('hatly-service-type-buy')), findsNothing);
      expect(find.byKey(const Key('hatly-service-place-name')), findsNothing);

      await tester.enterText(
          find.byKey(const Key('hatly-service-description')), 'صنف إضافي');
      await _settle(tester);
      await tester.tap(find.byType(ElevatedButton).first); // -> review
      await _settle(tester);
      await tester.tap(find.byType(ElevatedButton).first); // submit
      await _settle(tester);

      expect(cartApi.addAdHocCalls, hasLength(1));
      final call = cartApi.addAdHocCalls.single;
      expect(call['cartVendorGroupId'], 'existing-group');
      expect(call['adHocPlaceName'], isNull);
      expect(call['adHocServiceType'], isNull);
    });
  });
}
