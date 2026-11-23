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
import 'package:hatly_customer/features/addresses/presentation/address_selection_screen.dart';

import '../../support/router_test_app.dart';

const _abuNaseeb = DeliveryZone(
  id: 'zone-1',
  name: 'Abu Naseeb',
  nameAr: 'أبو نصيب',
  city: 'Belbeis',
  cityAr: 'بلبيس',
  governorate: 'Sharqia',
  governorateAr: 'الشرقية',
  deliveryFeeMinor: 1500,
);
const _secondZone = DeliveryZone(
  id: 'zone-2',
  name: 'Second Area',
  nameAr: 'منطقة تانية',
  city: 'Belbeis',
  cityAr: 'بلبيس',
  governorate: 'Sharqia',
  governorateAr: 'الشرقية',
  deliveryFeeMinor: 2000,
);

class _FakeAddressesApi implements AddressesApi {
  /// The zones the backend returns — the ONLY source of the dropdown (never hardcoded in the app).
  List<DeliveryZone> zones = const [_abuNaseeb, _secondZone];
  Object? zonesFailure;
  int zoneCalls = 0;
  final created = <AddressInput>[];
  final updated = <({String id, AddressInput input})>[];
  String? suggestion = 'شارع الجمهورية، بلبيس، الشرقية';
  ({double latitude, double longitude})? searchResult = (latitude: 30.42, longitude: 31.56);
  List<SavedAddress> saved = [];
  Object? createFailure;
  AddressCapabilities capabilities = const AddressCapabilities(manualAvailable: true, gpsAvailable: true);
  final reverseCalls = <(double, double)>[];
  final searchCalls = <String>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<SavedAddress>> getAddresses() async => saved;

  @override
  Future<AddressCapabilities> getCapabilities() async => capabilities;

  @override
  Future<List<DeliveryZone>> getDeliveryZones() async {
    zoneCalls++;
    if (zonesFailure != null) throw zonesFailure!;
    return zones;
  }

  @override
  Future<SavedAddress> createAddress(AddressInput input) async {
    if (createFailure != null) throw createFailure!;
    created.add(input);
    return SavedAddress(
        id: 'new-1',
        mode: input.mode,
        line1: input.line1 ?? '',
        latitude: input.latitude,
        longitude: input.longitude,
        deliveryZoneId: input.deliveryZoneId,
        isDefault: input.isDefault ?? false);
  }

  @override
  Future<SavedAddress> updateAddress(String addressId, AddressInput input) async {
    updated.add((id: addressId, input: input));
    return SavedAddress(
        id: addressId, mode: input.mode, line1: input.line1 ?? '', latitude: input.latitude, longitude: input.longitude, deliveryZoneId: input.deliveryZoneId);
  }

  @override
  Future<String?> reverseGeocode(double latitude, double longitude) async {
    reverseCalls.add((latitude, longitude));
    return suggestion;
  }

  @override
  Future<({double latitude, double longitude})?> searchAddress(String query) async {
    searchCalls.add(query);
    return searchResult;
  }
}

class _FakeLocation implements DeviceLocationService {
  _FakeLocation({this.fails = false, this.reason = LocationUnavailableReason.denied});
  final bool fails;
  final LocationUnavailableReason reason;

  @override
  Future<DeviceLocationResult> getCurrentLocation() async {
    if (fails) throw LocationUnavailableException('denied', reason);
    return const DeviceLocationResult(latitude: 30.4, longitude: 31.5);
  }

  @override
  Future<bool> openAppSettings() async => true;

  @override
  Future<bool> openLocationSettings() async => true;
}

Future<({_FakeAddressesApi api, List<Object?> popped})> _pump(
  WidgetTester tester, {
  SavedAddress? existing,
  bool locationFails = false,
  LocationUnavailableReason locationFailureReason = LocationUnavailableReason.denied,
  bool dark = false,
  Locale locale = const Locale('ar'),
  double scale = 1.0,
  double width = 390,
  _FakeAddressesApi? api,
  AddressMode? choose = AddressMode.manual,
}) async {
  final fake = api ?? _FakeAddressesApi();
  final popped = <Object?>[];
  tester.view.physicalSize = Size(width * 3, 3000 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyRouterApp(
    dark: dark,
    locale: locale,
    textScale: scale,
    overrides: [
      addressesApiProvider.overrideWithValue(fake),
      deviceLocationServiceProvider.overrideWithValue(
          _FakeLocation(fails: locationFails, reason: locationFailureReason)),
    ],
    routes: [
      GoRoute(
        path: '/',
        builder: (c, s) => Scaffold(
          body: Center(
            child: ElevatedButton(
              key: const Key('open'),
              onPressed: () async => popped.add(await c.push<SavedAddress>('/form')),
              child: const Text('open'),
            ),
          ),
        ),
      ),
      GoRoute(
        path: '/form',
        // `mapEnabled: false` — no native map exists in a widget test; this is the no-key fallback build.
        builder: (c, s) => AddAddressScreen(existing: existing, mapEnabled: false),
      ),
    ],
  ));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('open')));
  await tester.pumpAndSettle();
  // A NEW address starts on the method chooser: pick the manual method (this file covers the manual journey; GPS is in
  // address_methods_test.dart). `choose: null` stays on the chooser.
  if (existing == null && choose != null) {
    await tester.tap(find.byKey(Key(choose == AddressMode.gps ? 'address-method-gps' : 'address-method-manual')));
    await tester.pumpAndSettle();
  }
  return (api: fake, popped: popped);
}

Future<void> _enter(WidgetTester tester, String key, String text) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.enterText(find.byKey(Key(key)), text);
}

/// The zone dropdown (governorate / city are preselected when the backend offers only one of each).
Finder get _zoneDropdown => find.byWidgetPredicate(
    (w) => w is DropdownButtonFormField<String> && w.key is ValueKey<String> && (w.key as ValueKey<String>).value.startsWith('address-zone-'));

Future<void> _selectZone(WidgetTester tester, {String nameAr = 'أبو نصيب'}) async {
  await tester.ensureVisible(_zoneDropdown);
  await tester.tap(_zoneDropdown);
  await tester.pumpAndSettle();
  await tester.tap(find.text(nameAr).last);
  await tester.pumpAndSettle();
}

Future<void> _save(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(const Key('address-save')));
  await tester.tap(find.byKey(const Key('address-save')));
  await tester.pumpAndSettle();
}

void main() {
  group('Delivery Zones (PD-009): the zone locates the address, the map pin is optional', () {
    testWidgets('zones come from the backend: governorate and city are preselected, the area must be chosen', (tester) async {
      final r = await _pump(tester);
      expect(r.api.zoneCalls, 1);
      expect(find.text('الشرقية'), findsWidgets);
      expect(find.text('بلبيس'), findsWidgets);
      expect(find.byKey(const Key('address-zone-help')), findsOneWidget);
      await tester.tap(_zoneDropdown);
      await tester.pumpAndSettle();
      expect(find.text('أبو نصيب'), findsWidgets);
      expect(find.text('منطقة تانية'), findsWidgets);
    });

    testWidgets('saving WITHOUT a map pin works when an area is chosen — a non-geocodable address is fine', (tester) async {
      final r = await _pump(tester);
      await _selectZone(tester);
      await _enter(tester, 'address-line1', 'شارع أبو نصيب جنب جامع الكردي، منزل 15');
      await _save(tester);
      final json = r.api.created.single.toJson();
      expect(json, {'mode': 'MANUAL', 'line1': 'شارع أبو نصيب جنب جامع الكردي، منزل 15', 'deliveryZoneId': 'zone-1'});
      expect(r.api.reverseCalls, isEmpty, reason: 'no geocoding was needed');
      expect((r.popped.single as SavedAddress).id, 'new-1');
    });

    testWidgets('the area is required — nothing is sent without one', (tester) async {
      final r = await _pump(tester);
      await _enter(tester, 'address-line1', 'شارع الجمهورية');
      await _save(tester);
      expect(find.text('اختار المنطقة'), findsWidgets);
      expect(r.api.created, isEmpty);
    });

    testWidgets('a city with exactly ONE active zone: it is selected for the customer (data-driven), shown as selected, and saved', (tester) async {
      final api = _FakeAddressesApi()..zones = const [_abuNaseeb];
      final r = await _pump(tester, api: api);
      expect(find.byKey(const Key('address-zone-auto-selected')), findsOneWidget);
      expect(find.text('أبو نصيب'), findsWidgets, reason: 'the selected zone is visible in the field');
      await _enter(tester, 'address-line1', 'شارع أبو نصيب جنب جامع الكردي، منزل 15');
      await _save(tester);
      expect(r.api.created.single.deliveryZoneId, 'zone-1', reason: 'saved without touching the dropdown');
    });

    testWidgets('the single-zone shortcut is data-driven: a different single zone from the backend is selected the same way', (tester) async {
      const other = DeliveryZone(id: 'zone-x', name: 'X', nameAr: 'منطقة إكس', city: 'Zagazig', cityAr: 'الزقازيق', governorate: 'Sharqia', governorateAr: 'الشرقية', deliveryFeeMinor: 999);
      final api = _FakeAddressesApi()..zones = const [other];
      final r = await _pump(tester, api: api);
      await _enter(tester, 'address-line1', 'شارع');
      await _save(tester);
      expect(r.api.created.single.deliveryZoneId, 'zone-x');
    });

    testWidgets('a city with SEVERAL zones: nothing is preselected and every active zone of that city is offered', (tester) async {
      await _pump(tester);
      expect(find.byKey(const Key('address-zone-auto-selected')), findsNothing);
      await tester.tap(_zoneDropdown);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-zone-option-zone-1')), findsWidgets);
      expect(find.byKey(const Key('address-zone-option-zone-2')), findsWidgets);
    });

    testWidgets('switching city re-applies the rule: a one-zone city gets its zone, a several-zone city asks', (tester) async {
      const zag = DeliveryZone(id: 'zone-z', name: 'Z', nameAr: 'منطقة الزقازيق', city: 'Zagazig', cityAr: 'الزقازيق', governorate: 'Sharqia', governorateAr: 'الشرقية', deliveryFeeMinor: 1000);
      final api = _FakeAddressesApi()..zones = const [_abuNaseeb, _secondZone, zag];
      final r = await _pump(tester, api: api);
      final city = find.byWidgetPredicate((w) => w is DropdownButtonFormField<String> && w.key is ValueKey<String> && (w.key as ValueKey<String>).value.startsWith('address-city-'));
      await tester.tap(city);
      await tester.pumpAndSettle();
      await tester.tap(find.text('الزقازيق').last);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-zone-auto-selected')), findsOneWidget);
      await _enter(tester, 'address-line1', 'شارع');
      await _save(tester);
      expect(r.api.created.single.deliveryZoneId, 'zone-z');
    });

    testWidgets("an address whose city now has NO active zone says so, and can't be saved without a zone", (tester) async {
      const gone = SavedAddress(
        id: 'a7',
        line1: 'شارع',
        deliveryZoneId: 'zone-old',
        deliveryZone: DeliveryZone(id: 'zone-old', name: 'Old', nameAr: 'قديمة', city: 'Minya', cityAr: 'المنيا', governorate: 'Minya', governorateAr: 'المنيا'),
        zoneStatus: AddressZoneStatus.unavailable,
      );
      final r = await _pump(tester, existing: gone);
      expect(find.byKey(const Key('address-city-no-zones')), findsOneWidget);
      await _save(tester);
      expect(r.api.updated, isEmpty);
    });

    testWidgets('a LEGACY address is never assigned a zone on its behalf — even when its city has a single zone', (tester) async {
      const legacy = SavedAddress(id: 'old-2', line1: 'شارع قديم', city: 'بلبيس', governorate: 'الشرقية', zoneStatus: AddressZoneStatus.missing);
      final api = _FakeAddressesApi()..zones = const [_abuNaseeb];
      final r = await _pump(tester, existing: legacy, api: api);
      expect(find.byKey(const Key('address-zone-auto-selected')), findsNothing);
      expect(find.byKey(const Key('address-zone-banner')), findsOneWidget);
      await _save(tester);
      expect(r.api.updated, isEmpty, reason: 'the customer must confirm the zone explicitly');
      await _selectZone(tester);
      await _save(tester);
      expect(r.api.updated.single.input.deliveryZoneId, 'zone-1');
    });

    testWidgets("choosing an area shows that area's fee as information (the quote stays authoritative)", (tester) async {
      await _pump(tester);
      expect(find.byKey(const Key('address-zone-fee')), findsNothing);
      await _selectZone(tester, nameAr: 'منطقة تانية');
      expect(find.byKey(const Key('address-zone-fee')), findsOneWidget);
      expect(find.textContaining('20'), findsWidgets);
    });

    testWidgets('loading → error with retry → loaded', (tester) async {
      final api = _FakeAddressesApi()..zonesFailure = Exception('offline');
      await _pump(tester, api: api);
      expect(find.byKey(const Key('address-zones-error')), findsOneWidget);
      api.zonesFailure = null;
      await tester.tap(find.byKey(const Key('address-zones-retry')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-zones-error')), findsNothing);
      expect(_zoneDropdown, findsOneWidget);
      expect(api.zoneCalls, 2);
    });

    testWidgets('no zones offered: says so, and the form cannot be saved', (tester) async {
      final api = _FakeAddressesApi()..zones = const [];
      final r = await _pump(tester, api: api);
      expect(find.byKey(const Key('address-zones-empty')), findsOneWidget);
      await _enter(tester, 'address-line1', 'شارع');
      await _save(tester);
      expect(r.api.created, isEmpty);
    });

    testWidgets('an address saved before zones is NOT guessed into one: a banner asks, and saving sends the chosen zone', (tester) async {
      const legacy = SavedAddress(
        id: 'old-1',
        line1: 'شارع البحر',
        latitude: 30.41,
        longitude: 31.57,
        city: 'بلبيس',
        governorate: 'الشرقية',
        zoneStatus: AddressZoneStatus.missing,
      );
      final r = await _pump(tester, existing: legacy);
      expect(find.byKey(const Key('address-zone-banner')), findsOneWidget);
      await _save(tester);
      expect(r.api.updated, isEmpty, reason: 'no zone chosen yet');
      await _selectZone(tester);
      expect(find.byKey(const Key('address-zone-banner')), findsNothing);
      await _save(tester);
      expect(r.api.updated.single.input.deliveryZoneId, 'zone-1');
      expect(r.api.updated.single.input.latitude, isNull, reason: 'the manual method never sends coordinates (a pin needs the explicit GPS method)');
      expect(r.api.updated.single.input.mode, AddressMode.manual);
    });

    testWidgets('an address whose zone was deactivated must choose another (the old zone is not offered)', (tester) async {
      const stale = SavedAddress(
        id: 'a9',
        line1: 'شارع',
        deliveryZoneId: 'zone-gone',
        deliveryZone: DeliveryZone(id: 'zone-gone', name: 'Gone', nameAr: 'قديمة', city: 'Belbeis', cityAr: 'بلبيس', governorate: 'Sharqia', governorateAr: 'الشرقية'),
        zoneStatus: AddressZoneStatus.unavailable,
      );
      final r = await _pump(tester, existing: stale);
      expect(find.text('منطقة التوصيل بتاعة العنوان ده مش متاحة دلوقتي. اختار منطقة تانية.'), findsOneWidget);
      await _save(tester);
      expect(r.api.updated, isEmpty);
    });

    testWidgets('a server zone rejection is shown in plain words', (tester) async {
      final api = _FakeAddressesApi()
        ..createFailure = const ApiException(code: 'BAD_REQUEST', message: 'x', details: {'code': 'DELIVERY_ZONE_UNAVAILABLE'}, statusCode: 400);
      await _pump(tester, api: api);
      await _selectZone(tester);
      await _enter(tester, 'address-line1', 'شارع');
      await _save(tester);
      expect(find.text('هاتلي مش بيوصّل للمنطقة دي دلوقتي. اختار منطقة أو عنوان تاني.'), findsOneWidget);
    });
  });

  group('manual details and saving', () {
    testWidgets('sends every structured field the customer typed, trimmed; blanks are dropped; returns the saved address', (tester) async {
      final r = await _pump(tester);
      await _enter(tester, 'address-line1', '  شارع الجمهورية  ');
      await _selectZone(tester);
      await _enter(tester, 'address-building', '12');
      await _enter(tester, 'address-floor', '3');
      await _enter(tester, 'address-apartment', '8');
      await _enter(tester, 'address-landmark', 'بجوار الصيدلية');
      await _enter(tester, 'address-instructions', 'اتصل بي');
      await _enter(tester, 'address-label', 'المنزل');
      await tester.ensureVisible(find.byKey(const Key('address-default')));
      await tester.tap(find.byKey(const Key('address-default')));
      await tester.ensureVisible(find.byKey(const Key('address-save')));
      await tester.tap(find.byKey(const Key('address-save')));
      await tester.pumpAndSettle();

      final json = r.api.created.single.toJson();
      // Governorate / city are NOT sent — the server derives them from the zone, so they can never contradict it.
      expect(json, {
        'mode': 'MANUAL',
        'line1': 'شارع الجمهورية',
        'deliveryZoneId': 'zone-1',
        'label': 'المنزل',
        'instructions': 'اتصل بي',
        'buildingNumber': '12',
        'floor': '3',
        'apartment': '8',
        'landmark': 'بجوار الصيدلية',
        'isDefault': true,
      });
      expect((r.popped.single as SavedAddress).id, 'new-1');
    });

    testWidgets('the address line is required', (tester) async {
      final r = await _pump(tester);
      await tester.ensureVisible(find.byKey(const Key('address-save')));
      await tester.tap(find.byKey(const Key('address-save')));
      await tester.pumpAndSettle();
      expect(find.text('اكتب عنوان التوصيل'), findsOneWidget);
      expect(r.api.created, isEmpty);
    });

    testWidgets('a save failure is reported and the form stays', (tester) async {
      final api = _FakeAddressesApi()..createFailure = Exception('boom');
      await _pump(tester, api: api);
      await _enter(tester, 'address-line1', 'شارع');
      await _selectZone(tester);
      await tester.ensureVisible(find.byKey(const Key('address-save')));
      await tester.tap(find.byKey(const Key('address-save')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-error')), findsOneWidget);
      expect(find.byKey(const Key('address-save')), findsOneWidget);
    });

    testWidgets('editing pre-fills every manual field and updates in place — never with coordinates', (tester) async {
      const existing = SavedAddress(
        id: 'a1',
        label: 'العمل',
        line1: 'شارع البحر',
        latitude: 30.41,
        longitude: 31.57,
        governorate: 'الشرقية',
        city: 'بلبيس',
        deliveryZoneId: 'zone-1',
        deliveryZone: _abuNaseeb,
        buildingNumber: '7',
        floor: '2',
        apartment: '4',
        landmark: 'أمام البنك',
        instructions: 'الدور الثاني',
        formattedAddress: 'شارع البحر، بلبيس',
        isDefault: true,
      );
      final r = await _pump(tester, existing: existing);
      expect(find.byKey(const Key('address-gps-detected')), findsNothing, reason: 'a manual address shows no GPS section at all');
      expect(find.text('أبو نصيب'), findsWidgets, reason: "the address's own zone is preselected");
      expect(tester.widget<Switch>(find.descendant(of: find.byKey(const Key('address-default')), matching: find.byType(Switch))).value, isTrue);
      await _enter(tester, 'address-floor', '5');
      await tester.ensureVisible(find.byKey(const Key('address-save')));
      await tester.tap(find.byKey(const Key('address-save')));
      await tester.pumpAndSettle();
      final u = r.api.updated.single;
      expect(u.id, 'a1');
      expect(u.input.latitude, isNull);
      expect(u.input.floor, '5');
      expect(u.input.deliveryZoneId, 'zone-1');
    });
  });

  group('themes, RTL and small screens', () {
    for (final dark in [false, true]) {
      for (final locale in [const Locale('ar'), const Locale('en')]) {
        for (final scale in [1.0, 2.0]) {
          testWidgets('no overflow: ${locale.languageCode} ${dark ? 'dark' : 'light'} 320 ${scale}x', (tester) async {
            await _pump(tester, dark: dark, locale: locale, scale: scale, width: 320);
            expect(tester.takeException(), isNull);
            await _pump(tester, dark: dark, locale: locale, scale: scale, width: 320, choose: null); // the method chooser
            expect(tester.takeException(), isNull);
          });
        }
      }
    }
  });

  group('address list', () {
    testWidgets('marks the default address and returns the tapped one', (tester) async {
      final api = _FakeAddressesApi()
        ..saved = const [
          SavedAddress(id: 'a1', label: 'المنزل', line1: 'شارع 1', latitude: 1, longitude: 2, city: 'بلبيس', governorate: 'الشرقية', isDefault: true),
          SavedAddress(id: 'a2', line1: 'شارع 2', latitude: 1, longitude: 2),
        ];
      final popped = <Object?>[];
      await tester.pumpWidget(hatlyRouterApp(
        overrides: [addressesApiProvider.overrideWithValue(api)],
        routes: [
          GoRoute(
            path: '/',
            builder: (c, s) => Scaffold(
              body: ElevatedButton(
                key: const Key('open'),
                onPressed: () async => popped.add(await c.push<SavedAddress>('/list')),
                child: const Text('open'),
              ),
            ),
          ),
          GoRoute(path: '/list', builder: (c, s) => const AddressSelectionScreen()),
        ],
      ));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('open')));
      await tester.pumpAndSettle();
      expect(find.text('افتراضي'), findsOneWidget);
      expect(find.text('بلبيس، الشرقية'), findsOneWidget);
      await tester.tap(find.byKey(const Key('address-tile-a2')));
      await tester.pumpAndSettle();
      expect((popped.single as SavedAddress).id, 'a2');
    });

    testWidgets('PD-009: the zone is shown; an address that NEEDS a zone opens the editor instead of being returned half-usable', (tester) async {
      final api = _FakeAddressesApi()
        ..saved = const [
          SavedAddress(id: 'z1', line1: 'شارع أبو نصيب', deliveryZoneId: 'zone-1', deliveryZone: _abuNaseeb),
          SavedAddress(id: 'old', line1: 'شارع قديم', latitude: 1, longitude: 2, zoneStatus: AddressZoneStatus.missing),
        ];
      final popped = <Object?>[];
      final openedEditorFor = <String>[];
      await tester.pumpWidget(hatlyRouterApp(
        overrides: [addressesApiProvider.overrideWithValue(api)],
        routes: [
          GoRoute(
            path: '/',
            builder: (c, s) => Scaffold(
              body: ElevatedButton(
                key: const Key('open'),
                onPressed: () async => popped.add(await c.push<SavedAddress>('/list')),
                child: const Text('open'),
              ),
            ),
          ),
          GoRoute(path: '/list', builder: (c, s) => const AddressSelectionScreen()),
          GoRoute(
            path: '/addresses/add',
            builder: (c, s) {
              openedEditorFor.add((s.extra as SavedAddress).id);
              return const Scaffold(body: Text('editor'));
            },
          ),
        ],
      ));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('open')));
      await tester.pumpAndSettle();
      expect(find.text('بلبيس | أبو نصيب'), findsOneWidget);
      expect(find.byKey(const Key('address-needs-zone-old')), findsOneWidget);
      expect(find.byKey(const Key('address-needs-zone-z1')), findsNothing);

      await tester.tap(find.byKey(const Key('address-tile-old')));
      await tester.pumpAndSettle();
      expect(openedEditorFor, ['old']);
      expect(popped, isEmpty, reason: 'never returned to checkout without a zone');
    });
  });
}
