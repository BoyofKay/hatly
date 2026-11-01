import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/features/checkout/domain/checkout_quote.dart';
import 'package:hatly_customer/features/hatly_service/domain/route_endpoint.dart';
import 'package:hatly_customer/features/hatly_service/presentation/widgets/route_summary.dart';

import '../../support/router_test_app.dart';

void main() {
  group('route model parsing — nothing is invented', () {
    test('RouteDefaults reads each configured default and null for anything missing or malformed', () {
      final d = RouteDefaults.fromJson({
        'hatly': {
          'origin': {'latitude': 30.1, 'longitude': 31.1, 'label': ' Start '},
          'destination': null,
        },
        'wasally': {
          'destination': {'latitude': 'x', 'longitude': 31.3, 'label': 'bad'},
        },
      });
      expect(d.hatlyOrigin?.label, 'Start');
      expect(d.hatlyOrigin?.isDefault, isTrue);
      expect(d.hatlyDestination, isNull);
      expect(d.wasallyDestination, isNull);
      expect(RouteDefaults.fromJson(const {}).hatlyOrigin, isNull);
    });

    test('a resolved route needs BOTH ends; direction and sources are kept', () {
      final r = ResolvedRoute.tryParse({
        'origin': {'latitude': 30.1, 'longitude': 31.1, 'label': 'A', 'source': 'CUSTOMER'},
        'destination': {'latitude': 30.2, 'longitude': 31.2, 'label': 'B', 'source': 'DEFAULT'},
      });
      expect(r!.origin.label, 'A');
      expect(r.origin.isDefault, isFalse);
      expect(r.destination.isDefault, isTrue);
      expect(ResolvedRoute.tryParse({'origin': {'latitude': 30.1, 'longitude': 31.1}}), isNull);
      expect(ResolvedRoute.tryParse(null), isNull);
    });

    test('the quote carries the server-resolved route and service; an old backend (none) parses to null', () {
      final withRoute = QuoteDelivery.fromJson({
        'applicable': true,
        'source': 'FRESH',
        'vendorCount': 0,
        'vendors': [],
        'eta': {'available': false},
        'service': 'WASALLY',
        'route': {
          'origin': {'latitude': 30.1, 'longitude': 31.1, 'label': 'Here', 'source': 'CUSTOMER'},
          'destination': {'latitude': 30.2, 'longitude': 31.2, 'label': 'There', 'source': 'DEFAULT'},
        },
      });
      expect(withRoute.service, 'WASALLY');
      expect(withRoute.route!.destination.label, 'There');
      final without = QuoteDelivery.fromJson({'applicable': true, 'source': 'FRESH', 'vendorCount': 0, 'vendors': [], 'eta': {'available': false}});
      expect(without.route, isNull);
      expect(without.service, isNull);
    });
  });

  group('RouteSummary', () {
    Widget host(Widget child) => hatlyRouterApp(initialLocation: '/', routes: [
          GoRoute(path: '/', builder: (_, __) => Scaffold(body: Padding(padding: const EdgeInsets.all(16), child: child))),
        ]);

    testWidgets('read only: shows From then To with badges and no change buttons; a missing end says so and is flagged, not guessed', (tester) async {
      await tester.pumpWidget(host(const RouteSummary(
        origin: RouteEndpoint(latitude: 30.1, longitude: 31.1, label: 'مكتب هاتلي', source: RouteEndpointSource.defaultLocation),
        destination: null,
        destinationHint: 'اختر وجهة',
      )));
      await tester.pumpAndSettle();
      expect((tester.widget(find.byKey(const Key('route-origin-label'))) as Text).data, 'مكتب هاتلي');
      expect(find.byKey(const Key('route-origin-badge')), findsOneWidget);
      expect((tester.widget(find.byKey(const Key('route-destination-label'))) as Text).data, 'اختر وجهة');
      expect(find.byKey(const Key('route-destination-badge')), findsNothing);
      expect(find.byKey(const Key('route-origin-change')), findsNothing);
    });

    testWidgets('narrow screens (320 px) and long labels do not overflow', (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final long = 'عنوان طويل جدًا ' * 12;
      await tester.pumpWidget(host(RouteSummary(
        origin: RouteEndpoint(latitude: 30.1, longitude: 31.1, label: long),
        destination: RouteEndpoint(latitude: 30.2, longitude: 31.2, label: long),
        onChangeOrigin: () {},
        onChangeDestination: () {},
      )));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('route-origin-change')), findsOneWidget);
    });
  });
}
