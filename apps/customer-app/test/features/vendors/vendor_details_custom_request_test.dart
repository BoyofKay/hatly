import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/products/data/product_providers.dart';
import 'package:hatly_customer/features/vendors/data/vendor_providers.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_branch_summary.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_details.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_profile.dart';
import 'package:hatly_customer/features/vendors/presentation/vendor_details_screen.dart';
import 'package:hatly_customer/features/vendors/presentation/widgets/custom_request_action.dart';

import '../../support/test_app.dart';

VendorDetails _details({required bool allows}) => VendorDetails(
      vendor: const VendorProfile(id: 'v1', name: 'Pharmacy', category: ''),
      branch: VendorBranchSummary(
        id: 'b1',
        vendorId: 'v1',
        name: 'Pharmacy',
        address: 'x',
        latitude: 30,
        longitude: 31,
        isOpen: true,
        openingHours: const {},
        allowsCustomRequests: allows,
      ),
      ratingAverage: 0,
      ratingCount: 0,
      etaMinMinutes: 0,
      etaMaxMinutes: 0,
      deliveryFeeMinor: 0,
    );

Future<void> _pump(WidgetTester tester, {required bool allows}) async {
  tester.view.physicalSize = const Size(390 * 3, 2600 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyTestApp(
    const VendorDetailsScreen(vendorId: 'b1'),
    overrides: [
      vendorDetailsProvider('b1')
          .overrideWith((ref) async => _details(allows: allows)),
      productCategoriesProvider('b1').overrideWith((ref) async => []),
      productListProvider.overrideWith((ref, params) async => []),
    ],
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
      'the sector allows custom requests → the "can\'t find what you\'re looking for?" entry is offered',
      (tester) async {
    await _pump(tester, allows: true);
    expect(find.byType(CustomRequestAction), findsOneWidget);
  });

  testWidgets(
      'the sector does NOT allow them (restaurants, default) → no entry point at all',
      (tester) async {
    await _pump(tester, allows: false);
    expect(find.byType(CustomRequestAction), findsNothing);
    expect(find.byKey(const Key('custom-request-hint')), findsNothing);
  });

  test(
      'a response without the field (an older backend) is treated as NOT allowed',
      () {
    // The repository parses `json[\'allowsCustomRequests\'] as bool? ?? false`; the model default is the same.
    expect(_details(allows: false).branch.allowsCustomRequests, isFalse);
    expect(
        const VendorBranchSummary(
            id: 'b',
            vendorId: 'v',
            name: 'n',
            address: 'a',
            latitude: 0,
            longitude: 0,
            isOpen: true,
            openingHours: {}).allowsCustomRequests,
        isFalse);
  });
}
