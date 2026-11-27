import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/addresses/data/addresses_providers.dart';
import 'package:hatly_customer/features/addresses/domain/service_area.dart';
import 'package:hatly_customer/features/addresses/presentation/map_point_screen.dart';
import 'package:latlong2/latlong.dart';

import '../../support/test_app.dart';

/// Owner UAT 2026-11-27 (ML-03): the place is chosen on a map; outside the served area, or the same place as the other end, it cannot
/// be confirmed.
void main() {
  const area = ServiceAreaCircle(id: 'a', name: 'Belbeis', centerLatitude: 30.42, centerLongitude: 31.56, radiusMeters: 20000);

  Widget app(Widget child) => hatlyTestApp(child, locale: const Locale('en'), overrides: [
        serviceAreasProvider.overrideWith((ref) async => const [area]),
      ]);

  test('inside / outside the served areas; an unknown list never blocks', () {
    expect(insideServiceAreas(const [area], 30.42, 31.56), isTrue);
    expect(insideServiceAreas(const [area], 31.2, 29.9), isFalse);
    expect(insideServiceAreas(const [], 31.2, 29.9), isTrue);
  });

  testWidgets('a point inside the area can be confirmed', (tester) async {
    await tester.pumpWidget(app(const MapPointScreen(latitude: 30.42, longitude: 31.56, showTiles: false)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('map-point-blocker')), findsNothing);
    expect(tester.widget<ElevatedButton>(find.byKey(const Key('map-point-confirm'))).onPressed, isNotNull);
  });

  testWidgets('outside the area: confirm is off and the reason is shown', (tester) async {
    await tester.pumpWidget(app(const MapPointScreen(latitude: 31.2, longitude: 29.9, showTiles: false)));
    await tester.pumpAndSettle();
    expect(find.text('This place is outside the area Hatly serves.'), findsOneWidget);
    expect(tester.widget<ElevatedButton>(find.byKey(const Key('map-point-confirm'))).onPressed, isNull);
  });

  testWidgets('the same place as the other end cannot be confirmed', (tester) async {
    await tester.pumpWidget(app(const MapPointScreen(latitude: 30.42, longitude: 31.56, avoid: LatLng(30.4201, 31.5601), showTiles: false)));
    await tester.pumpAndSettle();
    expect(find.textContaining('same place as the other end'), findsOneWidget);
    expect(tester.widget<ElevatedButton>(find.byKey(const Key('map-point-confirm'))).onPressed, isNull);
  });
}
