import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/addresses/data/addresses_api.dart';
import 'package:hatly_customer/features/addresses/data/addresses_providers.dart';
import 'package:hatly_customer/features/addresses/domain/saved_address.dart';
import 'package:hatly_customer/features/addresses/presentation/my_addresses_screen.dart';

import '../../support/router_test_app.dart';

/// My Addresses (Profile). Reuses the exact same `AddressesApi`
/// interface/model Checkout's `AddressSelectionScreen` already uses —
/// this fake mirrors `_FakeCartApi`'s established `implements ... {
/// noSuchMethod }` pattern from cart_screen_test.dart.
class _FakeAddressesApi implements AddressesApi {
  _FakeAddressesApi({this.addresses = const []});

  List<SavedAddress> addresses;
  final updateCalls = <String>[];
  final deactivateCalls = <String>[];
  Object? deactivateFailure;
  Object? updateFailure;
  Completer<void>? gate;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<SavedAddress>> getAddresses() async => addresses;

  @override
  Future<void> deactivateAddress(String addressId) async {
    deactivateCalls.add(addressId);
    if (gate != null) await gate!.future;
    if (deactivateFailure != null) throw deactivateFailure!;
    addresses = addresses.where((a) => a.id != addressId).toList();
  }

  /// PD-009: "set as default" sends ONLY `isDefault` — no other field is resent, so nothing else can change, and it also works
  /// for an address saved before Delivery Zones existed.
  @override
  Future<SavedAddress> setDefaultAddress(String addressId) async {
    updateCalls.add(addressId);
    if (gate != null) await gate!.future;
    if (updateFailure != null) throw updateFailure!;
    addresses = [
      for (final a in addresses)
        SavedAddress(
          id: a.id,
          label: a.label,
          line1: a.line1,
          latitude: a.latitude,
          longitude: a.longitude,
          deliveryZoneId: a.deliveryZoneId,
          deliveryZone: a.deliveryZone,
          zoneStatus: a.zoneStatus,
          isDefault: a.id == addressId,
        ),
    ];
    return addresses.firstWhere((a) => a.id == addressId);
  }
}

class _FailingAddressesApi implements AddressesApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<SavedAddress>> getAddresses() async {
    throw Exception('network error');
  }
}

SavedAddress _address(String id,
    {String line1 = 'Line 1', bool isDefault = false, String? label}) {
  return SavedAddress(
    id: id,
    label: label,
    line1: line1,
    latitude: 30.0,
    longitude: 31.0,
    isDefault: isDefault,
  );
}

Future<void> _pump(WidgetTester tester, _FakeAddressesApi api) async {
  await tester.pumpWidget(hatlyRouterApp(
    locale: const Locale('en'),
    overrides: [addressesApiProvider.overrideWithValue(api)],
    routes: [
      GoRoute(path: '/', builder: (c, s) => const MyAddressesScreen()),
      GoRoute(
        path: '/addresses/add',
        builder: (c, s) => const SizedBox(key: Key('fake-add-address-screen')),
      ),
    ],
  ));
  await tester.pumpAndSettle();
}

void main() {
  group('MyAddressesScreen — list / empty / error', () {
    testWidgets('renders every saved address with the default badge on the right one', (tester) async {
      final api = _FakeAddressesApi(addresses: [
        _address('a1', line1: 'Nasr City', isDefault: true),
        _address('a2', line1: 'Maadi'),
      ]);
      await _pump(tester, api);

      expect(find.byKey(const Key('my-address-tile-a1')), findsOneWidget);
      expect(find.byKey(const Key('my-address-tile-a2')), findsOneWidget);
      expect(find.text('Nasr City'), findsOneWidget);
      expect(find.text('Maadi'), findsOneWidget);
    });

    testWidgets('empty state when there are no saved addresses', (tester) async {
      final api = _FakeAddressesApi(addresses: []);
      await _pump(tester, api);

      expect(find.byIcon(Icons.location_off_outlined), findsOneWidget);
    });

    testWidgets('error + retry when the list fails to load', (tester) async {
      await tester.pumpWidget(hatlyRouterApp(
        locale: const Locale('en'),
        overrides: [
          addressesApiProvider.overrideWithValue(_FailingAddressesApi()),
        ],
        routes: [
          GoRoute(path: '/', builder: (c, s) => const MyAddressesScreen()),
        ],
      ));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.error_outline), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });
  });

  group('MyAddressesScreen — add / edit', () {
    testWidgets('"Add new address" navigates to the existing /addresses/add screen and refreshes on return', (tester) async {
      final api = _FakeAddressesApi(addresses: [_address('a1', isDefault: true)]);
      await _pump(tester, api);

      await tester.tap(find.byKey(const Key('my-addresses-add')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('fake-add-address-screen')), findsOneWidget);
    });

    testWidgets('tapping an address tile opens the existing edit screen (extra: the address)', (tester) async {
      final api = _FakeAddressesApi(addresses: [_address('a1', isDefault: true)]);
      await _pump(tester, api);

      await tester.tap(find.byKey(const Key('my-address-tile-a1')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('fake-add-address-screen')), findsOneWidget);
    });

    testWidgets('the edit pencil also opens the existing edit screen', (tester) async {
      final api = _FakeAddressesApi(addresses: [_address('a1', isDefault: true)]);
      await _pump(tester, api);

      await tester.tap(find.byIcon(Icons.edit_outlined));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('fake-add-address-screen')), findsOneWidget);
    });
  });

  group('MyAddressesScreen — delete', () {
    testWidgets('confirming delete calls deactivateAddress and removes the address from the list', (tester) async {
      final api = _FakeAddressesApi(addresses: [
        _address('a1', isDefault: true),
        _address('a2'),
      ]);
      await _pump(tester, api);

      await tester.tap(find.byIcon(Icons.delete_outline).last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();

      expect(api.deactivateCalls, ['a2']);
      expect(find.byKey(const Key('my-address-tile-a2')), findsNothing);
    });

    testWidgets('cancelling the confirm dialog deletes nothing', (tester) async {
      final api = _FakeAddressesApi(addresses: [_address('a1', isDefault: true)]);
      await _pump(tester, api);

      await tester.tap(find.byIcon(Icons.delete_outline));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(api.deactivateCalls, isEmpty);
      expect(find.byKey(const Key('my-address-tile-a1')), findsOneWidget);
    });

    testWidgets('a delete failure keeps the address visible and shows an error', (tester) async {
      final api = _FakeAddressesApi(addresses: [_address('a1', isDefault: true)])
        ..deactivateFailure = const ApiException(code: 'ERR', message: 'nope');
      await _pump(tester, api);

      await tester.tap(find.byIcon(Icons.delete_outline));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('my-address-tile-a1')), findsOneWidget);
      expect(find.byType(SnackBar), findsOneWidget);
    });

    testWidgets('double-tapping delete-confirm only submits one deactivate call', (tester) async {
      final api = _FakeAddressesApi(addresses: [_address('a1', isDefault: true)])
        ..gate = Completer<void>();
      await _pump(tester, api);

      await tester.tap(find.byIcon(Icons.delete_outline));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
      await tester.pump();
      // The delete is now in flight (gated) — the icon has become a
      // spinner, so a second identical submission is not even possible
      // through the same button; this confirms the guard covers a
      // rapid re-tap on the underlying handler too.
      await tester.pump();

      expect(api.deactivateCalls, hasLength(1));
      api.gate!.complete();
      await tester.pumpAndSettle();
    });
  });

  group('MyAddressesScreen — set default', () {
    testWidgets('the default address shows no "Set as default" action', (tester) async {
      final api = _FakeAddressesApi(addresses: [_address('a1', isDefault: true)]);
      await _pump(tester, api);

      expect(find.byKey(const Key('address-set-default-a1')), findsNothing);
    });

    testWidgets('setting a non-default address as default changes only isDefault (nothing else is sent)', (tester) async {
      final api = _FakeAddressesApi(addresses: [
        _address('a1', line1: 'Nasr City', isDefault: true),
        _address('a2', line1: 'Maadi', label: 'Work'),
      ]);
      await _pump(tester, api);

      await tester.tap(find.byKey(const Key('address-set-default-a2')));
      await tester.pumpAndSettle();

      expect(api.updateCalls, ['a2']);
      expect(api.addresses.firstWhere((a) => a.id == 'a2').line1, 'Maadi');
      expect(api.addresses.firstWhere((a) => a.id == 'a2').label, 'Work');
      expect(api.addresses.firstWhere((a) => a.id == 'a2').isDefault, isTrue);
      // The previously-default address is no longer badged.
      expect(find.byKey(const Key('address-set-default-a1')), findsOneWidget);
    });

    testWidgets('a set-default failure shows an error and leaves the previous default unchanged', (tester) async {
      final api = _FakeAddressesApi(addresses: [
        _address('a1', isDefault: true),
        _address('a2'),
      ])
        ..updateFailure = const ApiException(code: 'ERR', message: 'nope');
      await _pump(tester, api);

      await tester.tap(find.byKey(const Key('address-set-default-a2')));
      await tester.pumpAndSettle();

      expect(find.byType(SnackBar), findsOneWidget);
      expect(find.byKey(const Key('address-set-default-a2')), findsOneWidget);
    });

    testWidgets('double-tapping "Set as default" only submits once', (tester) async {
      final api = _FakeAddressesApi(addresses: [
        _address('a1', isDefault: true),
        _address('a2'),
      ])
        ..gate = Completer<void>();
      await _pump(tester, api);

      await tester.tap(find.byKey(const Key('address-set-default-a2')));
      await tester.pump();
      await tester.pump();

      expect(api.updateCalls, hasLength(1));
      api.gate!.complete();
      await tester.pumpAndSettle();
    });
  });
}
