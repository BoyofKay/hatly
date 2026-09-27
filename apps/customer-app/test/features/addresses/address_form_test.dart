import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/location/device_location_service.dart';
import 'package:hatly_customer/features/addresses/data/addresses_api.dart';
import 'package:hatly_customer/features/addresses/data/addresses_providers.dart';
import 'package:hatly_customer/features/addresses/domain/saved_address.dart';
import 'package:hatly_customer/features/addresses/presentation/add_address_screen.dart';
import 'package:hatly_customer/features/addresses/presentation/address_selection_screen.dart';

import '../../support/router_test_app.dart';

class _FakeAddressesApi implements AddressesApi {
  final created = <AddressInput>[];
  final updated = <({String id, AddressInput input})>[];
  String? suggestion = 'شارع الجمهورية، بلبيس، الشرقية';
  ({double latitude, double longitude})? searchResult = (latitude: 30.42, longitude: 31.56);
  List<SavedAddress> saved = [];
  Object? createFailure;
  final reverseCalls = <(double, double)>[];
  final searchCalls = <String>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<SavedAddress>> getAddresses() async => saved;

  @override
  Future<SavedAddress> createAddress(AddressInput input) async {
    if (createFailure != null) throw createFailure!;
    created.add(input);
    return SavedAddress(
        id: 'new-1',
        line1: input.line1,
        latitude: input.latitude,
        longitude: input.longitude,
        isDefault: input.isDefault ?? false);
  }

  @override
  Future<SavedAddress> updateAddress(String addressId, AddressInput input) async {
    updated.add((id: addressId, input: input));
    return SavedAddress(id: addressId, line1: input.line1, latitude: input.latitude, longitude: input.longitude);
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
  return (api: fake, popped: popped);
}

Future<void> _enter(WidgetTester tester, String key, String text) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.enterText(find.byKey(Key(key)), text);
}

void main() {
  group('the map pin is the authoritative location', () {
    testWidgets('saving without a pin is refused with a clear message — typed text alone is not a location', (tester) async {
      final r = await _pump(tester);
      await _enter(tester, 'address-line1', 'شارع الجمهورية');
      await tester.ensureVisible(find.byKey(const Key('address-save')));
      await tester.tap(find.byKey(const Key('address-save')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-error')), findsOneWidget);
      expect(r.api.created, isEmpty);
    });

    testWidgets('without a native map the picker offers GPS and address search, and says why', (tester) async {
      await _pump(tester);
      expect(find.byKey(const Key('address-no-map')), findsOneWidget);
      expect(find.byKey(const Key('address-map')), findsNothing);
      expect(find.byKey(const Key('address-use-current-location')), findsOneWidget);
      expect(find.byKey(const Key('address-search-field')), findsOneWidget);
    });

    testWidgets('GPS sets the pin and asks for an assistive address suggestion', (tester) async {
      final r = await _pump(tester);
      await tester.tap(find.byKey(const Key('address-use-current-location')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-location-captured')), findsOneWidget);
      expect(r.api.reverseCalls.single, (30.4, 31.5));
      expect(find.byKey(const Key('address-suggestion')), findsOneWidget);
    });

    testWidgets('GPS refused: a clear message, nothing fabricated', (tester) async {
      await _pump(tester, locationFails: true);
      await tester.tap(find.byKey(const Key('address-use-current-location')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-picker-message')), findsOneWidget);
      expect(find.byKey(const Key('address-location-captured')), findsNothing);
    });

    testWidgets('each of the 5 unavailable states gets its OWN message — never one generic string', (tester) async {
      final messages = <String>{};
      for (final reason in LocationUnavailableReason.values) {
        await _pump(tester, locationFails: true, locationFailureReason: reason);
        await tester.tap(find.byKey(const Key('address-use-current-location')));
        await tester.pumpAndSettle();
        final text = tester
            .widget<Text>(find.byKey(const Key('address-picker-message')))
            .data!;
        expect(text, isNotEmpty);
        messages.add(text);
      }
      expect(messages, hasLength(LocationUnavailableReason.values.length));
    });

    testWidgets('only "permanently denied" offers to open Settings — the one state the OS will never prompt for again',
        (tester) async {
      await _pump(tester,
          locationFails: true,
          locationFailureReason: LocationUnavailableReason.denied);
      await tester.tap(find.byKey(const Key('address-use-current-location')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-open-settings')), findsNothing);

      await _pump(tester,
          locationFails: true,
          locationFailureReason: LocationUnavailableReason.permanentlyDenied);
      await tester.tap(find.byKey(const Key('address-use-current-location')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-open-settings')), findsOneWidget);
      // tapping it never throws / crashes the picker
      await tester.tap(find.byKey(const Key('address-open-settings')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    testWidgets('address search moves the pin to the found point', (tester) async {
      final r = await _pump(tester);
      await tester.enterText(find.byKey(const Key('address-search-field')), 'بلبيس شارع الجمهورية');
      await tester.tap(find.byKey(const Key('address-search-button')));
      await tester.pumpAndSettle();
      expect(r.api.searchCalls.single, 'بلبيس شارع الجمهورية');
      expect(find.byKey(const Key('address-location-captured')), findsOneWidget);
      expect(r.api.reverseCalls.single, (30.42, 31.56));
    });

    testWidgets('nothing found: says so, keeps no pin', (tester) async {
      final api = _FakeAddressesApi()..searchResult = null;
      await _pump(tester, api: api);
      await tester.enterText(find.byKey(const Key('address-search-field')), 'مكان غير موجود');
      await tester.tap(find.byKey(const Key('address-search-button')));
      await tester.pumpAndSettle();
      expect(find.text('لم نجد هذا العنوان. جرّب صياغة أخرى أو استخدم موقعك الحالي.'), findsOneWidget);
      expect(find.byKey(const Key('address-location-captured')), findsNothing);
    });
  });

  group('Google\'s text is only a suggestion', () {
    testWidgets('it is offered, never applied silently; using it fills an EMPTY address line and is then stored as the formatted address', (tester) async {
      final r = await _pump(tester);
      await tester.tap(find.byKey(const Key('address-use-current-location')));
      await tester.pumpAndSettle();
      expect(find.text('شارع الجمهورية، بلبيس، الشرقية'), findsOneWidget);
      expect(tester.widget<TextField>(find.byKey(const Key('address-line1'))).controller!.text, isEmpty,
          reason: 'not applied without the customer choosing it');

      await tester.tap(find.byKey(const Key('address-use-suggestion')));
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byKey(const Key('address-line1'))).controller!.text, 'شارع الجمهورية، بلبيس، الشرقية');

      await tester.ensureVisible(find.byKey(const Key('address-save')));
      await tester.tap(find.byKey(const Key('address-save')));
      await tester.pumpAndSettle();
      expect(r.api.created.single.formattedAddress, 'شارع الجمهورية، بلبيس، الشرقية');
    });

    testWidgets('an ignored suggestion is NOT stored', (tester) async {
      final r = await _pump(tester);
      await tester.tap(find.byKey(const Key('address-use-current-location')));
      await tester.pumpAndSettle();
      await _enter(tester, 'address-line1', 'عمارة 5 شارع النصر');
      await tester.ensureVisible(find.byKey(const Key('address-save')));
      await tester.tap(find.byKey(const Key('address-save')));
      await tester.pumpAndSettle();
      expect(r.api.created.single.line1, 'عمارة 5 شارع النصر');
      expect(r.api.created.single.formattedAddress, isNull);
    });

    testWidgets('a suggestion the provider could not give is simply absent — nothing blocks', (tester) async {
      final api = _FakeAddressesApi()..suggestion = null;
      await _pump(tester, api: api);
      await tester.tap(find.byKey(const Key('address-use-current-location')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-suggestion')), findsNothing);
      expect(find.byKey(const Key('address-location-captured')), findsOneWidget);
    });
  });

  group('manual details and saving', () {
    testWidgets('sends every structured field the customer typed, trimmed; blanks are dropped; returns the saved address', (tester) async {
      final r = await _pump(tester);
      await tester.tap(find.byKey(const Key('address-use-current-location')));
      await tester.pumpAndSettle();
      await _enter(tester, 'address-line1', '  شارع الجمهورية  ');
      await _enter(tester, 'address-governorate', 'الشرقية');
      await _enter(tester, 'address-city', 'بلبيس');
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
      expect(json, {
        'line1': 'شارع الجمهورية',
        'latitude': 30.4,
        'longitude': 31.5,
        'label': 'المنزل',
        'instructions': 'اتصل بي',
        'governorate': 'الشرقية',
        'city': 'بلبيس',
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
      await tester.tap(find.byKey(const Key('address-use-current-location')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('address-save')));
      await tester.tap(find.byKey(const Key('address-save')));
      await tester.pumpAndSettle();
      expect(find.text('اكتب عنوان التوصيل'), findsOneWidget);
      expect(r.api.created, isEmpty);
    });

    testWidgets('a save failure is reported and the form stays', (tester) async {
      final api = _FakeAddressesApi()..createFailure = Exception('boom');
      await _pump(tester, api: api);
      await tester.tap(find.byKey(const Key('address-use-current-location')));
      await tester.pumpAndSettle();
      await _enter(tester, 'address-line1', 'شارع');
      await tester.ensureVisible(find.byKey(const Key('address-save')));
      await tester.tap(find.byKey(const Key('address-save')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('address-error')), findsOneWidget);
      expect(find.byKey(const Key('address-save')), findsOneWidget);
    });

    testWidgets('editing pre-fills everything (including the pin) and updates in place', (tester) async {
      const existing = SavedAddress(
        id: 'a1',
        label: 'العمل',
        line1: 'شارع البحر',
        latitude: 30.41,
        longitude: 31.57,
        governorate: 'الشرقية',
        city: 'بلبيس',
        buildingNumber: '7',
        floor: '2',
        apartment: '4',
        landmark: 'أمام البنك',
        instructions: 'الدور الثاني',
        formattedAddress: 'شارع البحر، بلبيس',
        isDefault: true,
      );
      final r = await _pump(tester, existing: existing);
      expect(find.byKey(const Key('address-location-captured')), findsOneWidget, reason: 'the pin comes with the address');
      expect(tester.widget<TextField>(find.byKey(const Key('address-city'))).controller!.text, 'بلبيس');
      expect(tester.widget<Switch>(find.descendant(of: find.byKey(const Key('address-default')), matching: find.byType(Switch))).value, isTrue);
      await _enter(tester, 'address-floor', '5');
      await tester.ensureVisible(find.byKey(const Key('address-save')));
      await tester.tap(find.byKey(const Key('address-save')));
      await tester.pumpAndSettle();
      final u = r.api.updated.single;
      expect(u.id, 'a1');
      expect(u.input.latitude, 30.41);
      expect(u.input.floor, '5');
      expect(u.input.formattedAddress, 'شارع البحر، بلبيس', reason: 'an accepted suggestion is kept on edit');
    });
  });

  group('themes, RTL and small screens', () {
    for (final dark in [false, true]) {
      for (final locale in [const Locale('ar'), const Locale('en')]) {
        for (final scale in [1.0, 2.0]) {
          testWidgets('no overflow: ${locale.languageCode} ${dark ? 'dark' : 'light'} 320 ${scale}x', (tester) async {
            await _pump(tester, dark: dark, locale: locale, scale: scale, width: 320);
            await tester.tap(find.byKey(const Key('address-use-current-location')));
            await tester.pumpAndSettle();
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
  });
}
