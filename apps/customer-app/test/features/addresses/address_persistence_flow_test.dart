import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/location/device_location_service.dart';
import 'package:hatly_customer/features/addresses/data/addresses_api.dart';
import 'package:hatly_customer/features/addresses/data/addresses_providers.dart';
import 'package:hatly_customer/features/addresses/domain/delivery_zone.dart';
import 'package:hatly_customer/features/addresses/domain/saved_address.dart';
import 'package:hatly_customer/features/addresses/presentation/add_address_screen.dart';
import 'package:hatly_customer/features/addresses/presentation/address_selection_screen.dart';
import 'package:hatly_customer/features/addresses/presentation/my_addresses_screen.dart';
import 'package:hatly_customer/features/addresses/presentation/widgets/saved_address_picker.dart';

import '../../support/router_test_app.dart';

/// The customer's address journey as ONE flow per method (manual area + text, OR GPS): save it, "restart the app" (a brand-new widget tree and
/// provider scope talking to the same backend) and find it again with the same zone / pin / default.
///
/// The backend here is an in-memory stand-in that mirrors the documented rules of `AddressesService` (apps/backend/src/modules/
/// addresses): an active zone is required, the first address becomes the default, choosing a default clears the others, a pin is
/// optional and only ever the device's own fix. The REAL server behaviour is proven by the backend e2e `107-address-persistence`.
/// Maps are deferred in Production: address search finds nothing and reverse geocoding gives no suggestion — the flow must not need them.

const _zoneA = DeliveryZone(
    id: 'zone-a', name: 'Abu Naseeb', nameAr: 'أبو نصيب', city: 'Belbeis', cityAr: 'بلبيس', governorate: 'Sharqia', governorateAr: 'الشرقية', deliveryFeeMinor: 1500);
const _zoneB = DeliveryZone(
    id: 'zone-b', name: 'Second Area', nameAr: 'منطقة تانية', city: 'Belbeis', cityAr: 'بلبيس', governorate: 'Sharqia', governorateAr: 'الشرقية', deliveryFeeMinor: 2000);

class _BackendLikeApi implements AddressesApi {
  List<DeliveryZone> zones = const [_zoneA, _zoneB];
  Object? zonesFailure;
  final stored = <SavedAddress>[];
  final sentInputs = <AddressInput>[];
  var _seq = 0;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<AddressCapabilities> getCapabilities() async => const AddressCapabilities(manualAvailable: true, gpsAvailable: true);

  @override
  Future<List<DeliveryZone>> getDeliveryZones() async {
    if (zonesFailure != null) throw zonesFailure!;
    return zones;
  }

  @override
  Future<List<SavedAddress>> getAddresses() async => List.of(stored.reversed); // newest first, like the server

  @override
  Future<SavedAddress> createAddress(AddressInput input) async {
    sentInputs.add(input);
    // The server's rules: GPS = coordinates only (no zone, no text); MANUAL = an active zone + text, never coordinates.
    final isGps = input.mode == AddressMode.gps;
    final zone = isGps ? null : zones.firstWhere((z) => z.id == input.deliveryZoneId, orElse: () => throw StateError('zone not offered'));
    if (isGps && (input.latitude == null || input.longitude == null)) throw StateError('GPS needs both coordinates');
    if (!isGps && (input.latitude != null || input.longitude != null)) throw StateError('manual never carries coordinates');
    final makeDefault = input.isDefault ?? stored.isEmpty; // the first address becomes the default
    if (makeDefault) _clearDefault();
    final address = SavedAddress(
      id: 'addr-${++_seq}',
      mode: input.mode,
      label: input.label?.trim().isEmpty == true ? null : input.label?.trim(),
      line1: isGps ? gpsAddressText(input.latitude!, input.longitude!) : input.line1!,
      latitude: input.latitude,
      longitude: input.longitude,
      deliveryZoneId: zone?.id,
      deliveryZone: zone,
      city: zone?.cityAr,
      governorate: zone?.governorateAr,
      isDefault: makeDefault,
    );
    stored.add(address);
    return address;
  }

  @override
  Future<SavedAddress> setDefaultAddress(String addressId) async {
    _clearDefault();
    final i = stored.indexWhere((a) => a.id == addressId);
    stored[i] = _copy(stored[i], isDefault: true);
    return stored[i];
  }

  @override
  Future<String?> reverseGeocode(double latitude, double longitude) async => null; // Maps deferred: no suggestion

  @override
  Future<({double latitude, double longitude})?> searchAddress(String query) async => null; // Maps deferred: nothing found

  void _clearDefault() {
    for (var i = 0; i < stored.length; i++) {
      if (stored[i].isDefault) stored[i] = _copy(stored[i], isDefault: false);
    }
  }

  SavedAddress _copy(SavedAddress a, {required bool isDefault}) => SavedAddress(
        id: a.id,
        mode: a.mode,
        label: a.label,
        line1: a.line1,
        latitude: a.latitude,
        longitude: a.longitude,
        deliveryZoneId: a.deliveryZoneId,
        deliveryZone: a.deliveryZone,
        city: a.city,
        governorate: a.governorate,
        isDefault: isDefault,
      );
}

class _Gps implements DeviceLocationService {
  @override
  Future<DeviceLocationResult> getCurrentLocation() async => const DeviceLocationResult(latitude: 30.4207, longitude: 31.5613);

  @override
  Future<bool> openAppSettings() async => true;

  @override
  Future<bool> openLocationSettings() async => true;
}

void _phone(WidgetTester tester, {double width = 390}) {
  tester.view.physicalSize = Size(width * 3, 3000 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

/// A fresh app instance (= the app was closed and opened again) over the SAME backend.
Future<void> _launch(WidgetTester tester, _BackendLikeApi backend, {required String start, Locale locale = const Locale('ar'), double scale = 1.0, double width = 390, List<Object?>? popped}) async {
  _phone(tester, width: width);
  await tester.pumpWidget(const SizedBox()); // tear the previous app down completely
  await tester.pumpWidget(hatlyRouterApp(
    locale: locale,
    textScale: scale,
    initialLocation: start,
    overrides: [
      addressesApiProvider.overrideWithValue(backend),
      deviceLocationServiceProvider.overrideWithValue(_Gps()),
    ],
    routes: [
      GoRoute(
        path: '/',
        builder: (c, s) => Scaffold(
          body: Center(
            child: ElevatedButton(
              key: const Key('open'),
              onPressed: () async {
                // (not `popped?.add(await …)`: a null-aware call would skip evaluating the push when `popped` is null)
                final result = await c.push<SavedAddress>('/addresses/add');
                popped?.add(result);
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
      GoRoute(path: '/addresses', builder: (c, s) => const MyAddressesScreen()),
      GoRoute(path: '/checkout/address', builder: (c, s) => const AddressSelectionScreen()),
      GoRoute(path: '/addresses/add', builder: (c, s) => const AddAddressScreen(mapEnabled: false)),
    ],
  ));
  await tester.pumpAndSettle();
}

/// Opens the add-address screen and picks the method on its FIRST screen (manual unless a test asks for GPS).
Future<void> _openForm(WidgetTester tester, {AddressMode method = AddressMode.manual}) async {
  await tester.tap(find.byKey(const Key('open')));
  await tester.pumpAndSettle();
  expect(find.byKey(const Key('address-method-chooser')), findsOneWidget);
  await tester.tap(find.byKey(Key(method == AddressMode.gps ? 'address-method-gps' : 'address-method-manual')));
  await tester.pumpAndSettle();
}

Future<void> _enter(WidgetTester tester, String key, String text) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.enterText(find.byKey(Key(key)), text);
}

Finder get _zoneDropdown => find.byWidgetPredicate(
    (w) => w is DropdownButtonFormField<String> && w.key is ValueKey<String> && (w.key as ValueKey<String>).value.startsWith('address-zone-'));

Future<void> _chooseZone(WidgetTester tester, String nameAr) async {
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
  group('MANUAL method: area + written address, no location at all', () {
    testWidgets('it shows only the manual fields (no search, no GPS), saves with a zone and NO coordinates, and is a text address after a restart', (tester) async {
      final backend = _BackendLikeApi();
      final popped = <Object?>[];
      await _launch(tester, backend, start: '/', popped: popped);
      await _openForm(tester);

      // nothing of the GPS method is on this form
      expect(find.byKey(const Key('address-search-field')), findsNothing);
      expect(find.byKey(const Key('address-use-current-location')), findsNothing);
      expect(find.byKey(const Key('address-no-map')), findsNothing);

      await _enter(tester, 'address-line1', 'شارع الجمهورية، عمارة 5');
      await _enter(tester, 'address-building', '5');
      await _enter(tester, 'address-floor', '3');
      await _chooseZone(tester, 'أبو نصيب');
      await _save(tester);

      expect(backend.sentInputs, hasLength(1));
      expect(backend.sentInputs.single.mode, AddressMode.manual);
      expect(backend.sentInputs.single.latitude, isNull);
      expect(backend.sentInputs.single.longitude, isNull);
      expect(backend.sentInputs.single.deliveryZoneId, 'zone-a');
      expect((popped.single as SavedAddress).line1, 'شارع الجمهورية، عمارة 5');

      // "restart the app": new tree, same backend
      await _launch(tester, backend, start: '/addresses', locale: const Locale('en'));
      expect(find.text('شارع الجمهورية، عمارة 5'), findsOneWidget);
      expect(find.byKey(const Key('address-text-only-addr-1')), findsOneWidget);
      expect(find.byKey(const Key('address-pinned-addr-1')), findsNothing);
      expect(find.text('Address text only — no map location'), findsOneWidget);
      expect(find.text('Default'), findsOneWidget, reason: 'the first address becomes the default');
    });
  });

  group('GPS method: the location is the whole address', () {
    testWidgets('it shows no area dropdown and no address text, saves the device fix exactly (no zone, no text), and survives a restart as a GPS address', (tester) async {
      final backend = _BackendLikeApi();
      await _launch(tester, backend, start: '/');
      await _openForm(tester, method: AddressMode.gps);

      // nothing of the manual method is on this form
      expect(find.byKey(const Key('address-line1')), findsNothing);
      expect(find.byKey(const Key('address-zone-help')), findsNothing);
      expect(_zoneDropdown, findsNothing);
      expect(find.byKey(const Key('address-search-field')), findsNothing, reason: 'GPS never asks for typed address text');
      // and nothing can be saved before a location exists
      expect(tester.widget<ElevatedButton>(find.byKey(const Key('address-save'))).onPressed, isNull);

      await tester.ensureVisible(find.byKey(const Key('address-use-current-location')));
      await tester.tap(find.byKey(const Key('address-use-current-location')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-gps-detected')), findsOneWidget);
      expect(find.byKey(const Key('address-gps-fee-note')), findsOneWidget, reason: 'the fee is calculated at checkout — and says so');
      await _save(tester);

      final sent = backend.sentInputs.single;
      expect(sent.mode, AddressMode.gps);
      expect(sent.latitude, 30.4207);
      expect(sent.longitude, 31.5613);
      expect(sent.deliveryZoneId, isNull, reason: 'a GPS address carries no zone');
      expect(sent.line1, isNull, reason: 'and no typed text');

      await _launch(tester, backend, start: '/addresses', locale: const Locale('ar'));
      expect(find.byKey(const Key('address-pinned-addr-1')), findsOneWidget);
      expect(find.text('موقع GPS'), findsOneWidget);
      expect(find.byKey(const Key('address-area-addr-1')), findsNothing, reason: 'a GPS address has no delivery area');
    });
  });

  group('default address', () {
    testWidgets('the chosen default is the only default and is the same after a restart', (tester) async {
      final backend = _BackendLikeApi();
      await _launch(tester, backend, start: '/');
      for (final line in ['العنوان الأول', 'العنوان التاني']) {
        await _openForm(tester);
        await _enter(tester, 'address-line1', line);
        await _chooseZone(tester, 'أبو نصيب');
        if (line == 'العنوان التاني') {
          await tester.ensureVisible(find.byKey(const Key('address-default')));
          await tester.tap(find.byKey(const Key('address-default')));
          await tester.pumpAndSettle();
        }
        await _save(tester);
      }
      expect(backend.stored.where((a) => a.isDefault).map((a) => a.line1), ['العنوان التاني']);

      await _launch(tester, backend, start: '/addresses', locale: const Locale('en'));
      expect(find.text('Default'), findsOneWidget);
      final secondTile = find.byKey(const Key('my-address-tile-addr-2'));
      expect(find.descendant(of: secondTile, matching: find.text('Default')), findsOneWidget);
    });
  });

  group('no usable delivery areas', () {
    testWidgets('empty list: the reason is shown and Save is OFF (nothing can be sent)', (tester) async {
      final backend = _BackendLikeApi()..zones = const [];
      await _launch(tester, backend, start: '/');
      await _openForm(tester);
      expect(find.byKey(const Key('address-zones-empty')), findsOneWidget);
      expect(find.textContaining('لا توجد مناطق توصيل متاحة بعد'), findsOneWidget);
      expect(tester.widget<ElevatedButton>(find.byKey(const Key('address-save'))).onPressed, isNull);
      expect(backend.sentInputs, isEmpty);
    });

    testWidgets('failed list: error + retry, Save is OFF until the zones arrive, then the same form saves', (tester) async {
      final backend = _BackendLikeApi()..zonesFailure = Exception('offline');
      await _launch(tester, backend, start: '/');
      await _openForm(tester);
      expect(find.byKey(const Key('address-zones-error')), findsOneWidget);
      expect(tester.widget<ElevatedButton>(find.byKey(const Key('address-save'))).onPressed, isNull);

      backend.zonesFailure = null;
      await tester.ensureVisible(find.byKey(const Key('address-zones-retry')));
      await tester.tap(find.byKey(const Key('address-zones-retry')));
      await tester.pumpAndSettle();
      expect(tester.widget<ElevatedButton>(find.byKey(const Key('address-save'))).onPressed, isNotNull);
      await _enter(tester, 'address-line1', 'بعد إعادة المحاولة');
      await _chooseZone(tester, 'أبو نصيب');
      await _save(tester);
      expect(backend.stored, hasLength(1));
    });
  });

  group('Hatly Service (custom order) uses the SAME saved addresses', () {
    testWidgets('a manual (text-only) address is listed but cannot be chosen and says why; a GPS address can', (tester) async {
      final backend = _BackendLikeApi();
      await backend.createAddress(const AddressInput.manual(line1: 'نص فقط', deliveryZoneId: 'zone-a'));
      await backend.createAddress(const AddressInput.gps(latitude: 30.42, longitude: 31.56));
      final chosen = <SavedAddress>[];
      _phone(tester);
      await tester.pumpWidget(hatlyRouterApp(
        locale: const Locale('en'),
        overrides: [addressesApiProvider.overrideWithValue(backend)],
        routes: [
          GoRoute(
            path: '/',
            builder: (c, s) => Scaffold(body: Padding(padding: const EdgeInsets.all(16), child: SavedAddressPicker(selectedId: null, requirePin: true, onSelected: chosen.add))),
          ),
        ],
      ));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('saved-address-dropdown')));
      await tester.pumpAndSettle();
      expect(find.text('No map location — add one in My Addresses'), findsOneWidget);
      await tester.tap(find.text('نص فقط').last, warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(chosen, isEmpty, reason: 'the text-only address is not selectable');
      if (find.text('30.42000, 31.56000').evaluate().isEmpty) {
        await tester.tap(find.byKey(const Key('saved-address-dropdown')));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.text('30.42000, 31.56000').last);
      await tester.pumpAndSettle();
      expect(chosen.single.id, 'addr-2');
    });
  });

  group('wire format', () {
    test('MANUAL sends the mode, the zone and the text — never coordinates', () {
      final json = const AddressInput.manual(line1: 'x', deliveryZoneId: 'z').toJson();
      expect(json, {'mode': 'MANUAL', 'line1': 'x', 'deliveryZoneId': 'z'});
      expect(json.containsKey('latitude'), isFalse);
    });

    test('GPS sends the mode and BOTH coordinates exactly — never a zone or text', () {
      final json = const AddressInput.gps(latitude: 30.4207, longitude: 31.5613).toJson();
      expect(json, {'mode': 'GPS', 'latitude': 30.4207, 'longitude': 31.5613});
    });

    test('against a backend that predates the methods the mode is simply not sent (legacy form)', () {
      final json = const AddressInput.manual(line1: 'x', deliveryZoneId: 'z', includeMode: false).toJson();
      expect(json.containsKey('mode'), isFalse);
    });

    test('half a pin is never restored (both coordinates or neither); a GPS address with no text shows its coordinates', () {
      final restored = SavedAddress.fromJson({'id': 'a', 'line1': 'x', 'latitude': 30.4, 'longitude': null, 'deliveryZoneId': 'z', 'zoneStatus': 'OK'});
      expect(restored.hasPin, isFalse);
      expect(restored.latitude, isNull);
      final gps = SavedAddress.fromJson({'id': 'g', 'mode': 'GPS', 'line1': '', 'latitude': 30.4207, 'longitude': 31.5613, 'zoneStatus': 'OK'});
      expect(gps.mode, AddressMode.gps);
      expect(gps.line1, '30.42070, 31.56130');
    });
  });

  for (final locale in const [Locale('ar'), Locale('en')]) {
    testWidgets('the list with its pin/text indicators lays out at 320 px and 2x text in ${locale.languageCode} without overflow', (tester) async {
      final backend = _BackendLikeApi();
      await backend.createAddress(const AddressInput.manual(line1: 'عنوان نصي طويل جدًا جدًا يشرح مكان المنزل بالتفصيل الممل عند الجيران', deliveryZoneId: 'zone-a', label: 'البيت'));
      await backend.createAddress(const AddressInput.gps(latitude: 30.4, longitude: 31.5));
      await _launch(tester, backend, start: '/addresses', locale: locale, scale: 2.0, width: 320);
      expect(find.byKey(const Key('address-text-only-addr-1')), findsOneWidget);
      expect(find.byKey(const Key('address-pinned-addr-2')), findsOneWidget);
      expect(tester.takeException(), isNull);

      // the checkout-side picker shares the same row layout (default badge, indicators, app-bar action)
      await _launch(tester, backend, start: '/checkout/address', locale: locale, scale: 2.0, width: 320);
      expect(find.byKey(const Key('address-tile-addr-1')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
