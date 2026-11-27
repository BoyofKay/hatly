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
import 'package:hatly_customer/features/hatly_service/data/hatly_service_api.dart';
import 'package:hatly_customer/features/hatly_service/domain/route_endpoint.dart';
import 'package:hatly_customer/features/hatly_service/presentation/hatly_service_screen.dart';
import 'package:hatly_customer/features/uploads/data/uploads_api.dart';
import 'package:hatly_customer/features/uploads/data/uploads_providers.dart';
import 'package:hatly_customer/features/addresses/domain/saved_address.dart';
import 'package:hatly_customer/shared_widgets/voice_note/voice_note_engine.dart';

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
    String? pickupLabel,
    String? destinationLabel,
    String? freeTextDescription,
    required int quantity,
    List<String>? imageUrls,
    String? voiceNoteUrl,
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
      'pickupLabel': pickupLabel,
      'destinationLabel': destinationLabel,
      'freeTextDescription': freeTextDescription,
      'quantity': quantity,
      'imageUrls': imageUrls,
      'voiceNoteUrl': voiceNoteUrl,
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
          adHocPickupLabel: pickupLabel,
          adHocDestinationLabel: destinationLabel,
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
              adHocPickupLabel: g.adHocPickupLabel,
              adHocDestinationLabel: g.adHocDestinationLabel,
              items: [...g.items, newItem],
            )
          else
            g,
      ];
    }
    return _cart();
  }

  final List<Map<String, dynamic>> routeCalls = [];

  @override
  Future<Cart> updateAdHocRoute({
    RouteEndpoint? origin,
    bool clearOrigin = false,
    RouteEndpoint? destination,
    bool clearDestination = false,
  }) async {
    routeCalls.add({'origin': origin, 'clearOrigin': clearOrigin, 'destination': destination, 'clearDestination': clearDestination});
    groups = [
      for (final g in groups)
        if (g.isAdHocService)
          CartGroup(
            id: g.id,
            groupType: g.groupType,
            adHocPlaceName: g.adHocPlaceName,
            adHocServiceType: g.adHocServiceType,
            adHocPickupLatitude: clearOrigin ? null : (origin?.latitude ?? g.adHocPickupLatitude),
            adHocPickupLongitude: clearOrigin ? null : (origin?.longitude ?? g.adHocPickupLongitude),
            adHocPickupLabel: clearOrigin ? null : (origin?.label ?? g.adHocPickupLabel),
            adHocDestinationLatitude: clearDestination ? null : (destination?.latitude ?? g.adHocDestinationLatitude),
            adHocDestinationLongitude: clearDestination ? null : (destination?.longitude ?? g.adHocDestinationLongitude),
            adHocDestinationLabel: clearDestination ? null : (destination?.label ?? g.adHocDestinationLabel),
            items: g.items,
          )
        else
          g,
    ];
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

  final List<int> audioSizes = [];

  @override
  Future<String> uploadAudio(List<int> bytes) async {
    audioSizes.add(bytes.length);
    return 'https://uploads.test/voice.m4a';
  }
}

/// Stands in for the microphone and player.
class _FakeVoiceEngine implements VoiceNoteEngine {
  bool allow = true;
  bool recording = false;
  final List<String> played = [];

  @override
  Future<bool> ensurePermission() async => allow;
  @override
  Future<void> startRecording() async => recording = true;
  @override
  Future<String?> stopRecording() async {
    recording = false;
    return '/tmp/fake-voice.m4a';
  }

  @override
  Future<void> cancelRecording() async => recording = false;
  @override
  Future<void> play(String pathOrUrl, {required void Function() onDone}) async => played.add(pathOrUrl);
  @override
  Future<void> stopPlayback() async {}
  @override
  Future<List<int>> readBytes(String path) async => List<int>.filled(1234, 1);
  @override
  Future<void> dispose() async {}
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

/// The customer's saved addresses as ordinary checkout lists them. `home` has a map pin (usable as a place); `zoneOnly` has a
/// delivery zone but NO pin, so it cannot supply coordinates for a pickup / destination.
const _home = SavedAddress(
    id: 'addr-home',
    label: 'المنزل',
    line1: 'شارع الجمهورية',
    latitude: 30.42,
    longitude: 31.56);
const _shop = SavedAddress(
    id: 'addr-shop',
    label: 'المحل',
    line1: 'شارع النصر',
    latitude: 30.5,
    longitude: 31.7);
const _zoneOnly = SavedAddress(
    id: 'addr-zone',
    label: 'بدون خريطة',
    line1: 'حي الزهور',
    deliveryZoneId: 'z1');

/// Opens the saved-address dropdown and picks [id].
Future<void> _pickSaved(WidgetTester tester, String id) async {
  await tester.tap(find.byKey(const Key('saved-address-dropdown')));
  await _settle(tester);
  await tester.tap(find.byKey(Key('saved-address-item-$id')).last);
  await _settle(tester);
}

Widget _app({
  required _FakeCartApi cartApi,
  required _FakeUploadsApi uploadsApi,
  List<XFile>? imagesToPick,
  List<String>? visited,
  List<SavedAddress> saved = const [_home, _shop, _zoneOnly],
  SavedAddress? addedByAddScreen,
  RouteDefaults defaults = RouteDefaults.none,
  bool buyOnly = false,
  _FakeVoiceEngine? voice,
  Duration? voiceLimit,
}) {
  var pickIndex = 0;
  return hatlyRouterApp(
    overrides: [
      cartApiProvider.overrideWithValue(cartApi),
      uploadsApiProvider.overrideWithValue(uploadsApi),
      savedAddressesProvider.overrideWith((ref) async => saved),
      routeDefaultsProvider.overrideWith((ref) async => defaults),
      voiceNoteEngineProvider.overrideWith((ref) => voice ?? _FakeVoiceEngine()),
      voiceNoteLimitProvider.overrideWith((ref) async => voiceLimit ?? voiceNoteMaxDuration),
    ],
    initialLocation: '/hatly-service',
    routes: [
      GoRoute(
        path: '/hatly-service',
        builder: (context, state) => HatlyServiceScreen(
          buyFromPlaceOnly: buyOnly,
          pickImageOverride: imagesToPick == null
              ? null
              : () async {
                  if (pickIndex >= imagesToPick.length) return null;
                  return imagesToPick[pickIndex++];
                },
        ),
      ),
      probeRoute('/cart', visited: visited),
      // The normal Add Address screen, stood in for by a screen that "saves" an address and returns it, as the real one does.
      GoRoute(
        path: '/addresses/add',
        builder: (context, state) => Scaffold(
          body: Center(
            child: ElevatedButton(
              key: const Key('fake-add-address-save'),
              onPressed: () => context.pop(addedByAddScreen),
              child: const Text('save'),
            ),
          ),
        ),
      ),
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

const _hatlyStart = RouteEndpoint(latitude: 30.11, longitude: 31.11, label: 'نقطة بداية هاتلي', source: RouteEndpointSource.defaultLocation);
const _hatlyEnd = RouteEndpoint(latitude: 30.22, longitude: 31.22, label: 'وجهة هاتلي', source: RouteEndpointSource.defaultLocation);
const _wasallyEnd = RouteEndpoint(latitude: 30.33, longitude: 31.33, label: 'وجهة وصّلي', source: RouteEndpointSource.defaultLocation);
const _allDefaults = RouteDefaults(hatlyOrigin: _hatlyStart, hatlyDestination: _hatlyEnd, wasallyDestination: _wasallyEnd);

String _label(WidgetTester tester, String key) => (tester.widget(find.byKey(Key(key))) as Text).data!;
bool _badge(String rowKey) => find.byKey(Key('$rowKey-badge')).evaluate().isNotEmpty;
Finder _continueButton() => find.byType(ElevatedButton).first;
bool _canContinue(WidgetTester tester) => tester.widget<ElevatedButton>(_continueButton()).onPressed != null;

Future<void> _basics(WidgetTester tester, {required String typeKey}) async {
  await tester.tap(find.byKey(Key(typeKey)));
  await tester.enterText(find.byKey(const Key('hatly-service-place-name')), 'Carrefour');
  await tester.enterText(find.byKey(const Key('hatly-service-description')), 'اشترى لي شاي');
  await _settle(tester);
}

/// Opens the sheet of one end and picks a saved address that has a pin.
Future<void> _chooseSaved(WidgetTester tester, {required bool origin, String id = 'addr-home'}) async {
  await tester.ensureVisible(find.byKey(Key(origin ? 'route-origin-change' : 'route-destination-change')));
  await tester.tap(find.byKey(Key(origin ? 'route-origin-change' : 'route-destination-change')));
  await _settle(tester);
  await _pickSaved(tester, id);
}

void main() {
  group('sector-only navigation is presentation only', () {
    testWidgets('sector entry selects Hatly and never shows Wasaly type',
        (tester) async {
      _tallViewport(tester);
      await tester.pumpWidget(_app(
        cartApi: _FakeCartApi(), uploadsApi: _FakeUploadsApi(),
        defaults: _allDefaults, buyOnly: true));
      await _settle(tester);
      expect(find.byKey(const Key('hatly-service-type-buy')), findsOneWidget);
      expect(find.byKey(const Key('hatly-service-type-deliver')), findsNothing);
      expect(find.byKey(const Key('hatly-service-place-name')), findsOneWidget);
    });
    testWidgets('sector entry never converts an existing Wasaly cart group',
        (tester) async {
      _tallViewport(tester);
      final api = _FakeCartApi(initialGroups: [
        const CartGroup(
          id: 'existing-wasaly', groupType: 'AD_HOC_SERVICE',
          adHocPlaceName: 'Existing delivery',
          adHocServiceType: 'DELIVER_TO_PLACE', items: []),
      ]);
      await tester.pumpWidget(_app(
        cartApi: api, uploadsApi: _FakeUploadsApi(),
        defaults: _allDefaults, buyOnly: true));
      await _settle(tester);
      expect(find.byKey(const Key('hatly-service-type-deliver')), findsNothing);
      expect(find.byKey(const Key('hatly-service-place-name')), findsNothing);
      expect(api.addAdHocCalls, isEmpty);
    });
  });

  group('route ends: customer choice, else the service default, else nothing (PD-012)', () {
    testWidgets('Hatly with both defaults configured: the resolved route is shown with Default badges and the customer can continue without choosing', (tester) async {
      _tallViewport(tester);
      await tester.pumpWidget(_app(cartApi: _FakeCartApi(), uploadsApi: _FakeUploadsApi(), defaults: _allDefaults));
      await _settle(tester);
      await _basics(tester, typeKey: 'hatly-service-type-buy');

      expect(_label(tester, 'route-origin-label'), 'نقطة بداية هاتلي');
      expect(_label(tester, 'route-destination-label'), 'وجهة هاتلي');
      expect(_badge('route-origin'), isTrue);
      expect(_canContinue(tester), isTrue);
    });

    testWidgets('Hatly with NO defaults configured: nothing is invented — both ends say so and Continue stays off until the customer chooses BOTH', (tester) async {
      _tallViewport(tester);
      await tester.pumpWidget(_app(cartApi: _FakeCartApi(), uploadsApi: _FakeUploadsApi()));
      await _settle(tester);
      await _basics(tester, typeKey: 'hatly-service-type-buy');

      expect(_badge('route-origin'), isFalse);
      expect(_badge('route-destination'), isFalse);
      expect(_canContinue(tester), isFalse);

      await _chooseSaved(tester, origin: true);
      expect(_label(tester, 'route-origin-label'), 'المنزل');
      expect(_canContinue(tester), isFalse); // the destination is still missing

      await _chooseSaved(tester, origin: false, id: 'addr-shop');
      expect(_label(tester, 'route-destination-label'), 'المحل');
      expect(_canContinue(tester), isTrue);
    });

    testWidgets('Wasally: the origin is NEVER defaulted (not even with every default configured) and is never assumed to be home; the destination uses Wasally\'s own default', (tester) async {
      _tallViewport(tester);
      await tester.pumpWidget(_app(cartApi: _FakeCartApi(), uploadsApi: _FakeUploadsApi(), defaults: _allDefaults));
      await _settle(tester);
      await _basics(tester, typeKey: 'hatly-service-type-deliver');

      expect(_badge('route-origin'), isFalse);
      expect(_label(tester, 'route-destination-label'), 'وجهة وصّلي'); // Wasally's default, not Hatly's
      expect(_canContinue(tester), isFalse);

      await _chooseSaved(tester, origin: true);
      expect(_label(tester, 'route-origin-label'), 'المنزل'); // an explicit choice, never automatic
      expect(_canContinue(tester), isTrue);
    });

    testWidgets('each end changes independently, and "use the default" returns a changed end to the default without touching the other', (tester) async {
      _tallViewport(tester);
      await tester.pumpWidget(_app(cartApi: _FakeCartApi(), uploadsApi: _FakeUploadsApi(), defaults: _allDefaults));
      await _settle(tester);
      await _basics(tester, typeKey: 'hatly-service-type-buy');

      await _chooseSaved(tester, origin: false, id: 'addr-shop');
      expect(_label(tester, 'route-destination-label'), 'المحل');
      expect(_label(tester, 'route-origin-label'), 'نقطة بداية هاتلي'); // untouched

      await tester.ensureVisible(find.byKey(const Key('route-destination-change')));
      await tester.tap(find.byKey(const Key('route-destination-change')));
      await _settle(tester);
      await tester.ensureVisible(find.byKey(const Key('route-sheet-use-default')));
      await tester.tap(find.byKey(const Key('route-sheet-use-default')));
      await _settle(tester);
      expect(_label(tester, 'route-destination-label'), 'وجهة هاتلي');
    });

    testWidgets('a saved address without a map pin cannot be an end (requires coordinates)', (tester) async {
      _tallViewport(tester);
      await tester.pumpWidget(_app(cartApi: _FakeCartApi(), uploadsApi: _FakeUploadsApi()));
      await _settle(tester);
      await _basics(tester, typeKey: 'hatly-service-type-buy');
      await _chooseSaved(tester, origin: true, id: 'addr-zone');
      expect(_badge('route-origin'), isFalse); // nothing was chosen
    });

    testWidgets('switching the service type drops choices made for the other service', (tester) async {
      _tallViewport(tester);
      await tester.pumpWidget(_app(cartApi: _FakeCartApi(), uploadsApi: _FakeUploadsApi(), defaults: _allDefaults));
      await _settle(tester);
      await _basics(tester, typeKey: 'hatly-service-type-buy');
      await _chooseSaved(tester, origin: true);
      expect(_badge('route-origin'), isTrue);

      await tester.ensureVisible(find.byKey(const Key('hatly-service-type-deliver')));
      await tester.tap(find.byKey(const Key('hatly-service-type-deliver')));
      await _settle(tester);
      expect(_badge('route-origin'), isFalse);
      expect(_label(tester, 'route-destination-label'), 'وجهة وصّلي');
    });

    testWidgets('the review step repeats the resolved route before the customer confirms', (tester) async {
      _tallViewport(tester);
      await tester.pumpWidget(_app(cartApi: _FakeCartApi(), uploadsApi: _FakeUploadsApi(), defaults: _allDefaults));
      await _settle(tester);
      await _basics(tester, typeKey: 'hatly-service-type-buy');
      await _chooseSaved(tester, origin: true);
      await tester.ensureVisible(_continueButton());
      await tester.tap(_continueButton());
      await _settle(tester);

      expect(find.byKey(const Key('hatly-service-review-route')), findsOneWidget);
      expect(_label(tester, 'route-origin-label'), 'المنزل');
      expect(_label(tester, 'route-destination-label'), 'وجهة هاتلي');
    });
  });

  group('submission payload', () {
    Future<void> submit(WidgetTester tester) async {
      await tester.ensureVisible(_continueButton());
      await tester.tap(_continueButton()); // -> review
      await _settle(tester);
      await tester.tap(find.byType(ElevatedButton).first); // add to cart
      await _settle(tester);
    }

    testWidgets('only what the customer CHOSE is sent (with its label); an end left on the default is not sent, so the server resolves it', (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      final visited = <String>[];
      await tester.pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi(), visited: visited, defaults: _allDefaults));
      await _settle(tester);
      await _basics(tester, typeKey: 'hatly-service-type-buy');
      await _chooseSaved(tester, origin: true);
      await submit(tester);

      final call = cartApi.addAdHocCalls.single;
      expect(call['adHocServiceType'], 'BUY_FROM_PLACE');
      expect(call['pickupLatitude'], 30.42);
      expect(call['pickupLongitude'], 31.56);
      expect(call['pickupLabel'], 'المنزل');
      expect(call['destinationLatitude'], isNull);
      expect(call['destinationLongitude'], isNull);
      expect(call['destinationLabel'], isNull);
      expect(visited, contains('/cart'));
    });

    testWidgets('Wasally sends the customer-chosen ORIGIN as the pickup pair and its chosen destination as the destination pair', (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      await tester.pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi(), defaults: _allDefaults));
      await _settle(tester);
      await _basics(tester, typeKey: 'hatly-service-type-deliver');
      await _chooseSaved(tester, origin: true);
      await _chooseSaved(tester, origin: false, id: 'addr-shop');
      await submit(tester);

      final call = cartApi.addAdHocCalls.single;
      expect(call['adHocServiceType'], 'DELIVER_TO_PLACE');
      expect([call['pickupLatitude'], call['pickupLongitude']], [30.42, 31.56]);
      expect([call['destinationLatitude'], call['destinationLongitude']], [30.5, 31.7]);
      expect(call['destinationLabel'], 'المحل');
    });

    testWidgets('double-tapping "Add to cart" only submits once', (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi()..gate = Completer<void>();
      await tester.pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi(), defaults: _allDefaults));
      await _settle(tester);
      await _basics(tester, typeKey: 'hatly-service-type-buy');
      await tester.ensureVisible(_continueButton());
      await tester.tap(_continueButton());
      await _settle(tester);

      final submitButton = find.byType(ElevatedButton).first;
      await tester.tap(submitButton);
      await tester.pump();
      await tester.tap(submitButton); // fires before the first completes
      await tester.pump();
      cartApi.gate!.complete();
      await _settle(tester);
      expect(cartApi.addAdHocCalls, hasLength(1));
    });

    testWidgets('a failed photo upload submits nothing and keeps the entered request for a retry', (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      final uploads = _FakeUploadsApi()..failNextUpload = true;
      await tester.pumpWidget(_app(cartApi: cartApi, uploadsApi: uploads, defaults: _allDefaults, imagesToPick: [_fakeImage('a')]));
      await _settle(tester);
      await _basics(tester, typeKey: 'hatly-service-type-buy');
      await tester.ensureVisible(find.byKey(const Key('hatly-service-add-image')));
      await tester.tap(find.byKey(const Key('hatly-service-add-image')));
      // A decoded photo thumbnail keeps scheduling frames, so step the clock instead of waiting for it to go idle.
      await tester.pump(const Duration(milliseconds: 300));
      await tester.ensureVisible(_continueButton());
      await tester.tap(_continueButton());
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.byType(ElevatedButton).first);
      // Reading the photo is real file IO, which only completes outside the test's fake clock.
      for (var i = 0; i < 4; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 150)));
        await tester.pump(const Duration(milliseconds: 100));
      }

      expect(uploads.callCount, 1);
      expect(cartApi.addAdHocCalls, isEmpty);
      expect(find.byKey(const Key('hatly-service-error')), findsOneWidget);
    });
  });

  group('a request already in the cart', () {
    CartGroup group({String type = 'BUY_FROM_PLACE', double? pickupLat, double? destinationLat}) => CartGroup(
          id: 'existing-group',
          groupType: 'AD_HOC_SERVICE',
          adHocPlaceName: 'Carrefour',
          adHocServiceType: type,
          adHocPickupLatitude: pickupLat,
          adHocPickupLongitude: pickupLat == null ? null : 31.0,
          adHocPickupLabel: pickupLat == null ? null : 'بداية العميل',
          adHocDestinationLatitude: destinationLat,
          adHocDestinationLongitude: destinationLat == null ? null : 31.5,
          adHocDestinationLabel: destinationLat == null ? null : 'وجهة العميل',
          items: const [],
        );

    testWidgets('type, place name and a new route are not asked again — the existing group id is reused and Continue needs only a description', (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi(initialGroups: [group()]);
      await tester.pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi(), defaults: _allDefaults));
      await _settle(tester);

      expect(find.byKey(const Key('hatly-service-existing-group-notice')), findsOneWidget);
      expect(find.byKey(const Key('hatly-service-type-buy')), findsNothing);
      await tester.enterText(find.byKey(const Key('hatly-service-description')), 'صنف إضافي');
      await _settle(tester);
      await tester.ensureVisible(_continueButton());
      await tester.tap(_continueButton());
      await _settle(tester);
      await tester.tap(find.byType(ElevatedButton).first);
      await _settle(tester);

      final call = cartApi.addAdHocCalls.single;
      expect(call['cartVendorGroupId'], 'existing-group');
      expect(call['adHocServiceType'], isNull);
      expect(call['pickupLatitude'], isNull); // ends of an existing group are changed only through the route edit
    });

    testWidgets('shows the group\'s own ends (customer choice, else default) and edits each end through the cart route update', (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi(initialGroups: [group(pickupLat: 30.9)]);
      await tester.pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi(), defaults: _allDefaults));
      await _settle(tester);

      expect(_label(tester, 'route-origin-label'), 'بداية العميل');
      expect(_label(tester, 'route-destination-label'), 'وجهة هاتلي'); // default

      await _chooseSaved(tester, origin: false, id: 'addr-shop');
      expect(cartApi.routeCalls.single['destination'], isA<RouteEndpoint>());
      expect(cartApi.routeCalls.single['clearOrigin'], isFalse);
      expect(_label(tester, 'route-destination-label'), 'المحل');
      expect(_label(tester, 'route-origin-label'), 'بداية العميل'); // untouched

      await tester.ensureVisible(find.byKey(const Key('route-origin-change')));
      await tester.tap(find.byKey(const Key('route-origin-change')));
      await _settle(tester);
      await tester.ensureVisible(find.byKey(const Key('route-sheet-use-default')));
      await tester.tap(find.byKey(const Key('route-sheet-use-default')));
      await _settle(tester);
      expect(cartApi.routeCalls.last['clearOrigin'], isTrue);
      expect(_badge('route-origin'), isTrue);
      expect(_label(tester, 'route-origin-label'), 'نقطة بداية هاتلي');
    });

    testWidgets('a Wasally group without a chosen origin shows the missing origin (no default exists) instead of inventing one', (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi(initialGroups: [group(type: 'DELIVER_TO_PLACE')]);
      await tester.pumpWidget(_app(cartApi: cartApi, uploadsApi: _FakeUploadsApi(), defaults: _allDefaults));
      await _settle(tester);
      expect(_badge('route-origin'), isFalse);
      expect(_label(tester, 'route-destination-label'), 'وجهة وصّلي');
    });
  });

  group('voice notes (owner decision 2026-11-27): text, photos and voice are each optional, any one is enough', () {
    Future<void> record(WidgetTester tester, {int seconds = 3}) async {
      await tester.ensureVisible(find.byKey(const Key('voice-note-record')));
      await tester.tap(find.byKey(const Key('voice-note-record')));
      await tester.pump();
      for (var i = 0; i < seconds; i++) {
        await tester.pump(const Duration(seconds: 1));
      }
      await tester.tap(find.byKey(const Key('voice-note-stop')));
      await _settle(tester);
    }

    testWidgets('a voice-only request can continue, is uploaded once and sent as voiceNoteUrl with no text', (tester) async {
      _tallViewport(tester);
      final cartApi = _FakeCartApi();
      final uploads = _FakeUploadsApi();
      await tester.pumpWidget(_app(cartApi: cartApi, uploadsApi: uploads, defaults: _allDefaults));
      await _settle(tester);
      await tester.tap(find.byKey(const Key('hatly-service-type-buy')));
      await tester.enterText(find.byKey(const Key('hatly-service-place-name')), 'Carrefour');
      await _settle(tester);
      expect(_canContinue(tester), isFalse); // nothing said yet: no text, photo or voice

      await record(tester);
      expect(find.byKey(const Key('voice-note-attached')), findsOneWidget);
      expect(_canContinue(tester), isTrue);

      await tester.ensureVisible(_continueButton());
      await tester.tap(_continueButton());
      await _settle(tester);
      await tester.tap(find.byType(ElevatedButton).first);
      await _settle(tester);

      expect(uploads.audioSizes, [1234]);
      final call = cartApi.addAdHocCalls.single;
      expect(call['voiceNoteUrl'], 'https://uploads.test/voice.m4a');
      expect(call['freeTextDescription'], '');
    });

    testWidgets('recording stops by itself at the limit; deleting the note takes Continue away again', (tester) async {
      _tallViewport(tester);
      final engine = _FakeVoiceEngine();
      await tester.pumpWidget(_app(cartApi: _FakeCartApi(), uploadsApi: _FakeUploadsApi(), defaults: _allDefaults, voice: engine));
      await _settle(tester);
      await tester.tap(find.byKey(const Key('hatly-service-type-buy')));
      await tester.enterText(find.byKey(const Key('hatly-service-place-name')), 'Carrefour');
      await tester.ensureVisible(find.byKey(const Key('voice-note-record')));
      await tester.tap(find.byKey(const Key('voice-note-record')));
      await tester.pump();
      expect(engine.recording, isTrue);
      for (var i = 0; i < 301; i++) {
        await tester.pump(const Duration(seconds: 1));
      }
      await _settle(tester);
      expect(engine.recording, isFalse);
      expect((tester.widget(find.byKey(const Key('voice-note-attached'))) as Text).data, contains('5:00'));

      await tester.tap(find.byKey(const Key('voice-note-play')));
      await _settle(tester);
      expect(engine.played, ['/tmp/fake-voice.m4a']);

      await tester.tap(find.byKey(const Key('voice-note-delete')));
      await _settle(tester);
      expect(find.byKey(const Key('voice-note-record')), findsOneWidget);
      expect(_canContinue(tester), isFalse);
    });

    testWidgets('the limit set in Admin → Settings is used (here 1 minute)', (tester) async {
      _tallViewport(tester);
      final engine = _FakeVoiceEngine();
      await tester.pumpWidget(_app(cartApi: _FakeCartApi(), uploadsApi: _FakeUploadsApi(), defaults: _allDefaults, voice: engine, voiceLimit: const Duration(minutes: 1)));
      await _settle(tester);
      expect(find.textContaining('1:00'), findsWidgets); // the hint names the limit
      await tester.ensureVisible(find.byKey(const Key('voice-note-record')));
      await tester.tap(find.byKey(const Key('voice-note-record')));
      await tester.pump();
      for (var i = 0; i < 61; i++) {
        await tester.pump(const Duration(seconds: 1));
      }
      await _settle(tester);
      expect(engine.recording, isFalse);
      expect(find.byKey(const Key('voice-note-attached')), findsOneWidget);
    });

    testWidgets('a refused microphone says so and records nothing', (tester) async {
      _tallViewport(tester);
      final engine = _FakeVoiceEngine()..allow = false;
      await tester.pumpWidget(_app(cartApi: _FakeCartApi(), uploadsApi: _FakeUploadsApi(), defaults: _allDefaults, voice: engine));
      await _settle(tester);
      await tester.ensureVisible(find.byKey(const Key('voice-note-record')));
      await tester.tap(find.byKey(const Key('voice-note-record')));
      await _settle(tester);
      expect(find.byKey(const Key('voice-note-error')), findsOneWidget);
      expect(engine.recording, isFalse);
    });
  });
}
