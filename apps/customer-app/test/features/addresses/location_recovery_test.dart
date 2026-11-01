import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/location/device_location_service.dart';
import 'package:hatly_customer/features/addresses/data/addresses_providers.dart';
import 'package:hatly_customer/features/addresses/presentation/address_pin_picker.dart';

import '../../support/test_app.dart';

/// A location service whose failures are scripted in order; the last entry repeats. `null` = a successful fix.
class _Location implements DeviceLocationService {
  _Location(this.script);
  final List<LocationUnavailableReason?> script;
  int calls = 0;
  int appSettings = 0;
  int locationSettings = 0;

  @override
  Future<DeviceLocationResult> getCurrentLocation() async {
    final reason = script[calls < script.length ? calls : script.length - 1];
    calls++;
    if (reason != null) throw LocationUnavailableException('x', reason);
    return const DeviceLocationResult(latitude: 30.42, longitude: 31.56);
  }

  @override
  Future<bool> openAppSettings() async {
    appSettings++;
    return true;
  }

  @override
  Future<bool> openLocationSettings() async {
    locationSettings++;
    return true;
  }
}

Future<List<(double, double)>> _mount(WidgetTester t, _Location location, {Locale locale = const Locale('en')}) async {
  final fixes = <(double, double)>[];
  await t.pumpWidget(hatlyTestApp(
    SingleChildScrollView(child: AddressPinPicker(mapEnabled: false, showSearch: false, onChanged: (a, b) => fixes.add((a, b)))),
    locale: locale,
    overrides: [deviceLocationServiceProvider.overrideWithValue(location)],
  ));
  return fixes;
}

void main() {
  const useLocation = Key('address-use-current-location');

  testWidgets('a successful fix is passed on and no error is shown', (t) async {
    final loc = _Location([null]);
    final fixes = await _mount(t, loc);
    await t.tap(find.byKey(useLocation));
    await t.pumpAndSettle();
    expect(fixes, [(30.42, 31.56)]);
    expect(find.byKey(const Key('address-picker-message')), findsNothing);
  });

  testWidgets('location services OFF: says so, offers the device location switch, and retries by itself when the customer comes back', (t) async {
    final loc = _Location([LocationUnavailableReason.servicesDisabled, null]);
    final fixes = await _mount(t, loc);
    await t.tap(find.byKey(useLocation));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('address-picker-message')), findsOneWidget);
    expect(find.byKey(const Key('address-open-location-settings')), findsOneWidget);
    expect(find.byKey(const Key('address-open-settings')), findsNothing, reason: 'the app-permission page is the wrong place for this');

    await t.tap(find.byKey(const Key('address-open-location-settings')));
    await t.pump();
    expect(loc.locationSettings, 1);
    expect(fixes, isEmpty);

    // the customer switched location on and returned to the app
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await t.pumpAndSettle();
    expect(loc.calls, 2);
    expect(fixes, [(30.42, 31.56)]);
    expect(find.byKey(const Key('address-picker-message')), findsNothing);
    expect(find.byKey(const Key('address-open-location-settings')), findsNothing);
  });

  testWidgets('permission permanently denied: offers the app settings page and retries when the customer returns', (t) async {
    final loc = _Location([LocationUnavailableReason.permanentlyDenied, null]);
    final fixes = await _mount(t, loc);
    await t.tap(find.byKey(useLocation));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('address-open-settings')), findsOneWidget);
    expect(find.byKey(const Key('address-open-location-settings')), findsNothing);
    await t.tap(find.byKey(const Key('address-open-settings')));
    await t.pump();
    expect(loc.appSettings, 1);
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await t.pumpAndSettle();
    expect(fixes, [(30.42, 31.56)]);
  });

  testWidgets('a plain denial or a missing fix can simply be retried; returning from the background does NOT retry on its own', (t) async {
    final loc = _Location([LocationUnavailableReason.denied, LocationUnavailableReason.positionUnavailable, null]);
    final fixes = await _mount(t, loc);
    await t.tap(find.byKey(useLocation));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('address-picker-message')), findsOneWidget);
    expect(find.byKey(const Key('address-open-settings')), findsNothing);
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await t.pumpAndSettle();
    expect(loc.calls, 1, reason: 'no settings screen was opened, so nothing retries by itself');

    await t.tap(find.byKey(useLocation));
    await t.pumpAndSettle();
    expect(loc.calls, 2);
    await t.tap(find.byKey(useLocation));
    await t.pumpAndSettle();
    expect(fixes, [(30.42, 31.56)]);
  });

  testWidgets('Arabic: the location-services recovery is offered in Arabic', (t) async {
    final loc = _Location([LocationUnavailableReason.servicesDisabled]);
    await _mount(t, loc, locale: const Locale('ar'));
    await t.tap(find.byKey(useLocation));
    await t.pumpAndSettle();
    expect(find.text('فتح إعدادات الموقع'), findsOneWidget);
  });
}
