import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/features/auth/presentation/auth_gate.dart';
import 'package:hatly_customer/features/products/data/product_providers.dart';
import 'package:hatly_customer/features/products/data/product_repository.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/features/products/domain/product_category.dart';
import 'package:hatly_customer/features/vendors/data/vendor_providers.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_branch_summary.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_details.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_profile.dart';
import 'package:hatly_customer/features/vendors/presentation/vendor_details_screen.dart';

/// A store menu loads 20 products at a time: the first 20 on open, the next 20 only when the customer scrolls near the end,
/// and no further request once a page comes back short (a 25-item menu = exactly 2 requests).
class _PagedRepo implements ProductRepository {
  _PagedRepo(this.total);
  final int total;
  final requestedPages = <int?>[];

  @override
  Future<List<Product>> getProducts(String vendorBranchId,
      {String? categoryId,
      String? sort,
      String? search,
      int? page,
      int? limit,
      bool? availableOnly,
      bool? hasOffers,
      int? minPriceMinor,
      int? maxPriceMinor}) async {
    requestedPages.add(page);
    final p = page ?? 1;
    final size = limit ?? 20;
    final start = (p - 1) * size;
    final end = (start + size).clamp(0, total);
    return [
      for (var i = start; i < end; i++)
        Product(
            id: 'p$i',
            vendorBranchId: 'b1',
            categoryId: 'c1',
            name: 'Item $i',
            priceMinor: 1000 + i,
            isAvailable: true)
    ];
  }

  @override
  Future<List<ProductCategoryInfo>> getCategories(String vendorBranchId) async =>
      const [ProductCategoryInfo(id: 'c1', name: 'Menu', nameAr: 'المنيو')];

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

VendorDetails _details() => const VendorDetails(
      vendor: VendorProfile(id: 'v1', name: 'Tarweqa', category: ''),
      branch: VendorBranchSummary(
          id: 'b1',
          vendorId: 'v1',
          name: 'Tarweqa',
          address: 'Main St',
          latitude: 30,
          longitude: 31,
          isOpen: true,
          openingHours: {}),
      ratingAverage: 0,
      ratingCount: 0,
      etaMinMinutes: 0,
      etaMaxMinutes: 0,
      deliveryFeeMinor: 0,
    );

void main() {
  testWidgets('the first 20 load on open; scrolling to the end loads the rest; no extra request after a short page',
      (tester) async {
    HatlyTypography.useGoogleFonts = false;
    tester.view.physicalSize = const Size(390 * 3, 800 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final repo = _PagedRepo(25);
    final router = GoRouter(initialLocation: '/vendors/b1', routes: [
      GoRoute(path: '/vendors/:id', builder: (_, s) => VendorDetailsScreen(vendorId: s.pathParameters['id']!)),
    ]);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        isSignedInProvider.overrideWithValue(false),
        vendorDetailsProvider('b1').overrideWith((ref) async => _details()),
        productRepositoryProvider.overrideWithValue(repo),
      ],
      child: MaterialApp.router(
        routerConfig: router,
        theme: HatlyTheme.light(),
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
      ),
    ));
    await tester.pumpAndSettle();
    expect(repo.requestedPages, [null], reason: 'only the first page on open');

    final list = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(find.text('Item 19'), 400, scrollable: list);
    await tester.pumpAndSettle();
    expect(repo.requestedPages, [null, 2]);
    await tester.scrollUntilVisible(find.text('Item 24'), 400, scrollable: list);
    await tester.pumpAndSettle();
    expect(find.text('Item 24'), findsOneWidget);
    // Scroll further: page 2 was short (5 < 20), so nothing more is requested.
    await tester.drag(list, const Offset(0, -2000));
    await tester.pumpAndSettle();
    expect(repo.requestedPages, [null, 2]);
  });
}
