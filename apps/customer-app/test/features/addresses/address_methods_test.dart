import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/location/device_location_service.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/addresses/data/addresses_api.dart';
import 'package:hatly_customer/features/addresses/data/addresses_providers.dart';
import 'package:hatly_customer/features/addresses/domain/delivery_zone.dart';
import 'package:hatly_customer/features/addresses/domain/saved_address.dart';
import 'package:hatly_customer/features/addresses/presentation/add_address_screen.dart';

import '../../support/router_test_app.dart';

/// The two ALTERNATIVE address methods on the add/edit screen: the first screen offers GPS or manual; after choosing, ONLY that
/// method's fields exist; GPS never asks for an area or text, manual never asks for a location; switching is explicit and says what is
/// discarded; editing keeps the saved method. (The server-side rules are proven by backend e2e `110` / `111`.)

const _zone = DeliveryZone(
  id: 'zone-1',
  name: 'Abu Naseeb',
  nameAr: 'أبو نصيب',
  city: 'Belbeis',
  cityAr: 'بلبيس',
  governorate: 'Sharqia',
  governorateAr: 'الشرقية',
  deliveryFeeMinor: 1500,
);

// A second area in the same city, so nothing is auto-selected for the customer (the single-area shortcut is covered in address_form_test).
const _zone2 = DeliveryZone(
  id: 'zone-2',
  name: 'Second Area',
  nameAr: 'منطقة تانية',
  city: 'Belbeis',
  cityAr: 'بلبيس',
  governorate: 'Sharqia',
  governorateAr: 'الشرقية',
  deliveryFeeMinor: 2000,
);

class _Api implements AddressesApi {
  AddressCapabilities capabilities = const AddressCapabilities(manualAvailable: true, gpsAvailable: true);
  final created = <AddressInput>[];
  final updated = <({String id, AddressInput input})>[];
  Object? createFailure;
  int searchCalls = 0;
  int reverseCalls = 0;
  /// What the map provider resolves for a pin (null = nothing: Maps off, no result).
  String? reverseResult;
  Object? reverseFailure;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<AddressCapabilities> getCapabilities() async => capabilities;

  @override
  Future<List<DeliveryZone>> getDeliveryZones() async => const [_zone, _zone2];

  @override
  Future<List<SavedAddress>> getAddresses() async => const [];

  @override
  Future<SavedAddress> createAddress(AddressInput input) async {
    if (createFailure != null) throw createFailure!;
    created.add(input);
    return SavedAddress(id: 'new-1', mode: input.mode, line1: input.line1 ?? '', latitude: input.latitude, longitude: input.longitude, deliveryZoneId: input.deliveryZoneId);
  }

  @override
  Future<SavedAddress> updateAddress(String addressId, AddressInput input) async {
    updated.add((id: addressId, input: input));
    return SavedAddress(id: addressId, mode: input.mode, line1: input.line1 ?? '', latitude: input.latitude, longitude: input.longitude, deliveryZoneId: input.deliveryZoneId);
  }

  @override
  Future<String?> reverseGeocode(double latitude, double longitude) async {
    reverseCalls++;
    if (reverseFailure != null) throw reverseFailure!;
    return reverseResult;
  }

  @override
  Future<({double latitude, double longitude})?> searchAddress(String query) async {
    searchCalls++;
    return null;
  }
}

class _Location implements DeviceLocationService {
  _Location({this.denied = false});
  final bool denied;

  /// How many times the app asked for the location (= asked for permission).
  int calls = 0;

  @override
  Future<DeviceLocationResult> getCurrentLocation() async {
    calls++;
    if (denied) throw const LocationUnavailableException('denied', LocationUnavailableReason.denied);
    return const DeviceLocationResult(latitude: 30.4207, longitude: 31.5613);
  }

  @override
  Future<bool> openAppSettings() async => true;

  @override
  Future<bool> openLocationSettings() async => true;
}

Future<({_Api api, _Location location, List<Object?> popped})> _pump(
  WidgetTester tester, {
  SavedAddress? existing,
  _Api? api,
  bool denied = false,
  Locale locale = const Locale('ar'),
  double scale = 1.0,
  double width = 390,
}) async {
  final fake = api ?? _Api();
  final location = _Location(denied: denied);
  final popped = <Object?>[];
  tester.view.physicalSize = Size(width * 3, 3000 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyRouterApp(
    locale: locale,
    textScale: scale,
    overrides: [
      addressesApiProvider.overrideWithValue(fake),
      deviceLocationServiceProvider.overrideWithValue(location),
    ],
    routes: [
      GoRoute(
        path: '/',
        builder: (c, s) => Scaffold(
          body: Center(
            child: ElevatedButton(key: const Key('open'), onPressed: () async => popped.add(await c.push<SavedAddress>('/form')), child: const Text('open')),
          ),
        ),
      ),
      GoRoute(path: '/form', builder: (c, s) => AddAddressScreen(existing: existing, mapEnabled: false)),
    ],
  ));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('open')));
  await tester.pumpAndSettle();
  return (api: fake, location: location, popped: popped);
}

Future<void> _choose(WidgetTester tester, String method) async {
  await tester.tap(find.byKey(Key('address-method-$method')));
  await tester.pumpAndSettle();
}

Future<void> _tap(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

Finder get _zoneDropdown => find.byWidgetPredicate(
    (w) => w is DropdownButtonFormField<String> && w.key is ValueKey<String> && (w.key as ValueKey<String>).value.startsWith('address-zone-'));

void main() {
  group('first screen: two unmistakably different choices', () {
    testWidgets('a new address starts on the chooser — GPS and manual, nothing else (no form fields yet)', (tester) async {
      await _pump(tester);
      expect(find.byKey(const Key('address-method-chooser')), findsOneWidget);
      expect(find.byKey(const Key('address-method-gps')), findsOneWidget);
      expect(find.byKey(const Key('address-method-manual')), findsOneWidget);
      expect(find.text('استخدم موقعي الحالي (GPS)'), findsOneWidget);
      expect(find.text('هكتب عنواني بنفسي'), findsOneWidget);
      expect(find.byKey(const Key('address-line1')), findsNothing);
      expect(_zoneDropdown, findsNothing);
      expect(find.byKey(const Key('address-use-current-location')), findsNothing);
      expect(find.byKey(const Key('address-save')), findsNothing);
    });

    testWidgets('GPS is offered only when the backend says it can be priced; otherwise it is disabled with a reason and manual still works', (tester) async {
      final api = _Api()..capabilities = const AddressCapabilities(manualAvailable: true, gpsAvailable: false, gpsUnavailableReason: 'MAPS_DISABLED');
      final r = await _pump(tester, api: api);
      expect(find.byKey(const Key('address-method-gps-unavailable')), findsOneWidget);
      await tester.tap(find.byKey(const Key('address-method-gps')), warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-method-chooser')), findsOneWidget, reason: 'a disabled GPS card does not open the GPS journey');
      expect(r.location.calls, 0);
      await _choose(tester, 'manual');
      expect(find.byKey(const Key('address-line1')), findsOneWidget);
    });
  });

  group('GPS method', () {
    testWidgets('shows no area and no typed address; permission is requested only when the customer taps to share the location', (tester) async {
      final r = await _pump(tester);
      await _choose(tester, 'gps');
      expect(r.location.calls, 0, reason: 'choosing GPS alone does not touch the location');
      expect(find.byKey(const Key('address-line1')), findsNothing);
      expect(_zoneDropdown, findsNothing);
      expect(find.byKey(const Key('address-zone-help')), findsNothing);
      expect(find.byKey(const Key('address-building')), findsNothing);
      expect(find.byKey(const Key('address-search-field')), findsNothing, reason: 'GPS never asks for typed address text');
      await _tap(tester, 'address-use-current-location');
      expect(r.location.calls, 1);
    });

    testWidgets('nothing can be saved until a location exists; then it saves the coordinates only — mode GPS, no zone, no text', (tester) async {
      final r = await _pump(tester);
      await _choose(tester, 'gps');
      expect(tester.widget<ElevatedButton>(find.byKey(const Key('address-save'))).onPressed, isNull);
      expect(r.api.created, isEmpty);

      await _tap(tester, 'address-use-current-location');
      expect(find.byKey(const Key('address-gps-detected')), findsOneWidget);
      expect(find.text('30.42070, 31.56130'), findsOneWidget);
      expect(find.byKey(const Key('address-gps-fee-note')), findsOneWidget, reason: 'any amount before checkout is an estimate — and the note says so');
      await _tap(tester, 'address-save');

      expect(r.api.created.single.toJson(), {'mode': 'GPS', 'latitude': 30.4207, 'longitude': 31.5613});
      expect((r.popped.single as SavedAddress).mode, AddressMode.gps);
    });

    testWidgets('a pin the map provider can resolve shows the address (nothing to retype) and saves it as the assistive formattedAddress', (tester) async {
      final api = _Api()..reverseResult = 'شارع النصر، حي أبو نصيب، بلبيس';
      final r = await _pump(tester, api: api);
      await _choose(tester, 'gps');
      await _tap(tester, 'address-use-current-location');
      expect(r.api.reverseCalls, 1);
      expect(find.byKey(const Key('address-gps-resolved')), findsOneWidget);
      expect(find.text('شارع النصر، حي أبو نصيب، بلبيس'), findsOneWidget);
      expect(find.byKey(const Key('address-line1')), findsNothing, reason: 'the resolved address is never a field the customer has to fill');
      await _tap(tester, 'address-save');
      expect(r.api.created.single.toJson(), {'mode': 'GPS', 'latitude': 30.4207, 'longitude': 31.5613, 'formattedAddress': 'شارع النصر، حي أبو نصيب، بلبيس'});
    });

    testWidgets('when nothing can be resolved (Maps off, no result, or the lookup fails) the coordinates stand alone and saving is not blocked', (tester) async {
      for (final failure in [null, const ApiException(code: 'MAPS_DISABLED', message: 'off', statusCode: 400)]) {
        final api = _Api()..reverseFailure = failure;
        final r = await _pump(tester, api: api);
        await _choose(tester, 'gps');
        await _tap(tester, 'address-use-current-location');
        expect(find.byKey(const Key('address-gps-resolved')), findsNothing);
        expect(find.text('30.42070, 31.56130'), findsOneWidget);
        await _tap(tester, 'address-save');
        expect(r.api.created.single.toJson(), {'mode': 'GPS', 'latitude': 30.4207, 'longitude': 31.5613});
      }
    });

    testWidgets('a refused permission gives a clear message and saves nothing', (tester) async {
      final r = await _pump(tester, denied: true);
      await _choose(tester, 'gps');
      await _tap(tester, 'address-use-current-location');
      expect(find.byKey(const Key('address-picker-message')), findsOneWidget);
      expect(find.byKey(const Key('address-gps-detected')), findsNothing);
      expect(tester.widget<ElevatedButton>(find.byKey(const Key('address-save'))).onPressed, isNull);
      expect(r.api.created, isEmpty);
    });

    testWidgets('outside the delivery coverage the server refusal is explained in plain words (never a silent substitute)', (tester) async {
      final api = _Api()..createFailure = const ApiException(code: 'BAD_REQUEST', message: 'x', details: {'code': 'ADDRESS_OUT_OF_SERVICE_AREA'}, statusCode: 400);
      await _pump(tester, api: api);
      await _choose(tester, 'gps');
      await _tap(tester, 'address-use-current-location');
      await _tap(tester, 'address-save');
      expect(find.text('هاتلي لا توصّل للموقع ده لسه.'), findsOneWidget);
    });

    testWidgets('when distance pricing is unavailable the refusal says so and points to the manual method', (tester) async {
      final api = _Api()..createFailure = const ApiException(code: 'BAD_REQUEST', message: 'x', details: {'code': 'DISTANCE_PRICING_UNAVAILABLE'}, statusCode: 400);
      await _pump(tester, api: api);
      await _choose(tester, 'gps');
      await _tap(tester, 'address-use-current-location');
      await _tap(tester, 'address-save');
      expect(find.text('التوصيل بالموقع (GPS) مش متاح دلوقتي. اكتب عنوانك بنفسك.'), findsOneWidget);
    });
  });

  group('MANUAL method', () {
    testWidgets('never requests the location, never shows a map or search, and never sends coordinates', (tester) async {
      final r = await _pump(tester);
      await _choose(tester, 'manual');
      expect(find.byKey(const Key('address-use-current-location')), findsNothing);
      expect(find.byKey(const Key('address-no-map')), findsNothing);
      expect(find.byKey(const Key('address-map')), findsNothing);
      expect(find.byKey(const Key('address-search-field')), findsNothing);
      expect(find.byKey(const Key('address-gps-detected')), findsNothing);

      await tester.enterText(find.byKey(const Key('address-line1')), 'شارع المنشية');
      await tester.tap(_zoneDropdown);
      await tester.pumpAndSettle();
      await tester.tap(find.text('أبو نصيب').last);
      await tester.pumpAndSettle();
      await _tap(tester, 'address-save');

      expect(r.location.calls, 0, reason: 'the manual method never asks for the location or its permission');
      expect(r.api.searchCalls + r.api.reverseCalls, 0);
      expect(r.api.created.single.toJson(), {'mode': 'MANUAL', 'line1': 'شارع المنشية', 'deliveryZoneId': 'zone-1'});
    });

    testWidgets('requires the area and the written address, with specific messages', (tester) async {
      final r = await _pump(tester);
      await _choose(tester, 'manual');
      await _tap(tester, 'address-save');
      expect(r.api.created, isEmpty);
      expect(find.text('اكتب عنوان التوصيل'), findsOneWidget);
      expect(find.text('اختار المنطقة'), findsWidgets);
    });
  });

  group('changing the method is explicit and clears what the other method does not use', () {
    testWidgets('GPS → change: the dialog says the location will be discarded; cancel keeps it; confirm clears it and returns to the chooser', (tester) async {
      final r = await _pump(tester);
      await _choose(tester, 'gps');
      await _tap(tester, 'address-use-current-location');
      await _tap(tester, 'address-change-method');
      expect(find.byKey(const Key('address-change-method-dialog')), findsOneWidget);
      expect(find.text('هيتم مسح الموقع اللي اتحدد.'), findsOneWidget);

      await tester.tap(find.byKey(const Key('address-change-method-cancel')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-gps-detected')), findsOneWidget, reason: 'cancelling discards nothing');

      await _tap(tester, 'address-change-method');
      await tester.tap(find.byKey(const Key('address-change-method-confirm')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-method-chooser')), findsOneWidget);
      await _choose(tester, 'gps');
      expect(find.byKey(const Key('address-gps-detected')), findsNothing, reason: 'the old location is gone');
      expect(tester.widget<ElevatedButton>(find.byKey(const Key('address-save'))).onPressed, isNull);
      expect(r.api.created, isEmpty);
    });

    testWidgets('manual → change: the dialog says the area and typed address will be discarded; confirming clears them, so pricing methods never mix', (tester) async {
      final r = await _pump(tester);
      await _choose(tester, 'manual');
      await tester.enterText(find.byKey(const Key('address-line1')), 'شارع المنشية');
      await tester.tap(_zoneDropdown);
      await tester.pumpAndSettle();
      await tester.tap(find.text('أبو نصيب').last);
      await tester.pumpAndSettle();
      await _tap(tester, 'address-change-method');
      expect(find.text('هيتم مسح المنطقة المختارة والعنوان اللي كتبته.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('address-change-method-confirm')));
      await tester.pumpAndSettle();

      // back on the manual method the typed address and the area are gone ...
      await _choose(tester, 'manual');
      expect(tester.widget<TextField>(find.byKey(const Key('address-line1'))).controller!.text, isEmpty);
      expect(find.byKey(const Key('address-zone-fee')), findsNothing, reason: 'no area is selected any more');
      await _tap(tester, 'address-save');
      expect(r.api.created, isEmpty, reason: 'nothing is sent from the cleared manual form');

      // ... and going GPS sends none of the manual data.
      await _tap(tester, 'address-change-method');
      await tester.tap(find.byKey(const Key('address-change-method-confirm')));
      await tester.pumpAndSettle();
      await _choose(tester, 'gps');
      await _tap(tester, 'address-use-current-location');
      await _tap(tester, 'address-save');
      expect(r.api.created.single.toJson(), {'mode': 'GPS', 'latitude': 30.4207, 'longitude': 31.5613});
    });
  });

  group('editing preserves the saved method', () {
    testWidgets('a GPS address opens in the GPS journey with its location — no area, no text — and saves as GPS', (tester) async {
      const saved = SavedAddress(id: 'g1', mode: AddressMode.gps, line1: '30.42070, 31.56130', latitude: 30.4207, longitude: 31.5613, label: 'العمل', isDefault: true);
      final r = await _pump(tester, existing: saved);
      expect(find.byKey(const Key('address-method-chooser')), findsNothing);
      expect(find.byKey(const Key('address-gps-detected')), findsOneWidget);
      expect(find.byKey(const Key('address-line1')), findsNothing);
      expect(_zoneDropdown, findsNothing);
      await _tap(tester, 'address-save');
      expect(r.api.updated.single.id, 'g1');
      expect(r.api.updated.single.input.toJson(), {'mode': 'GPS', 'latitude': 30.4207, 'longitude': 31.5613, 'label': 'العمل', 'isDefault': true});
    });

    testWidgets('a manual address opens in the manual journey with its area and text — never the GPS section', (tester) async {
      const saved = SavedAddress(
          id: 'm1', mode: AddressMode.manual, line1: 'شارع البحر', deliveryZoneId: 'zone-1', deliveryZone: _zone, city: 'بلبيس', governorate: 'الشرقية');
      final r = await _pump(tester, existing: saved);
      expect(find.byKey(const Key('address-gps-detected')), findsNothing);
      expect(find.byKey(const Key('address-use-current-location')), findsNothing);
      expect(tester.widget<TextField>(find.byKey(const Key('address-line1'))).controller!.text, 'شارع البحر');
      await _tap(tester, 'address-save');
      expect(r.api.updated.single.input.toJson()['mode'], 'MANUAL');
      expect(r.api.updated.single.input.toJson().containsKey('latitude'), isFalse);
    });
  });

  group('a backend that predates the two methods', () {
    testWidgets('keeps the single legacy form (area + text): no chooser, no GPS, and no mode is sent', (tester) async {
      final api = _Api()..capabilities = AddressCapabilities.legacyBackend;
      final r = await _pump(tester, api: api);
      expect(find.byKey(const Key('address-method-chooser')), findsNothing);
      expect(find.byKey(const Key('address-change-method')), findsNothing);
      await tester.enterText(find.byKey(const Key('address-line1')), 'شارع المنشية');
      await tester.tap(_zoneDropdown);
      await tester.pumpAndSettle();
      await tester.tap(find.text('أبو نصيب').last);
      await tester.pumpAndSettle();
      await _tap(tester, 'address-save');
      expect(r.api.created.single.toJson(), {'line1': 'شارع المنشية', 'deliveryZoneId': 'zone-1'});
    });
  });

  group('layout', () {
    for (final locale in const [Locale('ar'), Locale('en')]) {
      testWidgets('chooser, GPS journey and manual journey lay out at 320 px / 2x text in ${locale.languageCode} without overflow', (tester) async {
        await _pump(tester, locale: locale, scale: 2.0, width: 320);
        expect(tester.takeException(), isNull);
        await _choose(tester, 'gps');
        await _tap(tester, 'address-use-current-location');
        expect(tester.takeException(), isNull);
        await _tap(tester, 'address-change-method');
        await tester.tap(find.byKey(const Key('address-change-method-confirm')));
        await tester.pumpAndSettle();
        await _choose(tester, 'manual');
        expect(tester.takeException(), isNull);
      });
    }
  });
}
