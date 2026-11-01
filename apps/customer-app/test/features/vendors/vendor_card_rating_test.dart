import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/favorites/data/favorites_api.dart';
import 'package:hatly_customer/features/auth/presentation/auth_gate.dart';
import 'package:hatly_customer/features/favorites/data/favorites_providers.dart';
import 'package:hatly_customer/features/vendors/domain/vendor.dart';
import 'package:hatly_customer/features/vendors/presentation/widgets/vendor_card.dart';

import '../../support/test_app.dart';

/// Visual UX (reference comparison) — the sector listing card shows the vendor's REAL rating (the trust signal a listing
/// is scanned for) beside the open/closed state; a vendor with no ratings shows none, and no ETA is ever invented.

class _NoFavoritesApi implements FavoritesApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

Vendor _vendor({int ratingCount = 0, double ratingAverage = 0}) => Vendor(
    id: 'v1',
    name: 'Abu Aly Grills',
    nameAr: 'مشويات أبو علي',
    category: '',
    ratingAverage: ratingAverage,
    ratingCount: ratingCount,
    etaMinMinutes: 0,
    etaMaxMinutes: 0,
    deliveryFeeMinor: 0,
    isOpen: true);

Future<void> _pump(WidgetTester tester, Vendor vendor,
    {double textScale = 1}) async {
  await tester.pumpWidget(hatlyTestApp(
    VendorCard(vendor: vendor, onTap: () {}),
    textScale: textScale,
    overrides: [
      isSignedInProvider.overrideWithValue(false),
      favoritesApiProvider.overrideWithValue(_NoFavoritesApi()),
    ],
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
      'a rated vendor shows ★ average (count) with the open badge, in Arabic',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(tester, _vendor(ratingCount: 37, ratingAverage: 4.25));
    expect(find.text('مشويات أبو علي'), findsOneWidget);
    expect(find.byKey(const Key('vendor-card-rating-v1')), findsOneWidget);
    expect(find.text('4.3'),
        findsOneWidget); // toStringAsFixed(1) of the backend average
    expect(find.text('(37)'), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp('التقييم 4.3')), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('no ratings yet → no stars and no fake 0.0; no ETA is invented',
      (tester) async {
    await _pump(tester, _vendor());
    expect(find.byKey(const Key('vendor-card-rating-v1')), findsNothing);
    expect(find.text('0.0'), findsNothing);
    expect(find.byIcon(Icons.schedule_rounded), findsNothing);
  });

  testWidgets('no overflow at 320px with 2× text (Arabic), rating shown',
      (tester) async {
    tester.view.physicalSize = const Size(320 * 3, 800 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await _pump(tester, _vendor(ratingCount: 12345, ratingAverage: 4.9),
        textScale: 2);
    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('vendor-card-rating-v1')), findsOneWidget);
  });
}
