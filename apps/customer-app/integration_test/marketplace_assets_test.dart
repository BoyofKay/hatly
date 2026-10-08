import 'dart:convert';
import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/config/api_config.dart';
import 'package:hatly_customer/core/storage/token_storage.dart';
import 'package:hatly_customer/core/theme/theme_mode_provider.dart';
import 'package:hatly_customer/main.dart';
import 'package:hatly_customer/shared_widgets/hatly_logo.dart';
import 'package:integration_test/integration_test.dart';

/// On-device smoke test: the REAL app, against a REAL running backend seeded with the marketplace asset pack
/// (`npm run seed:dev-marketplace` in apps/backend), proves the supplied images actually render — not just that files
/// exist. Every network image on each screen is decoded by the app's own image pipeline (CachedNetworkImage); any
/// failure fails the test. Screenshots land in build/marketplace-screens/.
///
///   flutter drive -d <device> --driver=test_driver/integration_test.dart \
///     --target=integration_test/marketplace_assets_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  Future<dynamic> api(String method, String path, {Object? body, String? token}) async {
    final client = HttpClient();
    try {
      final request = await client.openUrl(method, Uri.parse('$kApiBaseUrl$path'));
      request.headers.contentType = ContentType.json;
      if (token != null) request.headers.set('authorization', 'Bearer $token');
      if (body != null) request.write(jsonEncode(body));
      final response = await request.close();
      final text = await response.transform(utf8.decoder).join();
      if (response.statusCode >= 300) throw StateError('$method $path → ${response.statusCode} $text');
      return (jsonDecode(text) as Map<String, dynamic>)['data'];
    } finally {
      client.close();
    }
  }

  /// Pumps frames until [finder] matches (network-bound screens), failing after [timeout] — no fixed sleeps.
  Future<void> waitFor(WidgetTester tester, Finder finder, {Duration timeout = const Duration(seconds: 30)}) async {
    final end = DateTime.now().add(timeout);
    while (finder.evaluate().isEmpty) {
      if (DateTime.now().isAfter(end)) fail('timed out waiting for $finder');
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  /// Every CachedNetworkImage currently in the tree is decoded through the app's own provider; returns the URLs.
  Future<List<String>> expectAllImagesDecode(WidgetTester tester) async {
    final urls = tester.widgetList<CachedNetworkImage>(find.byType(CachedNetworkImage)).map((w) => w.imageUrl).toSet().toList();
    final errors = <String>[];
    final context = tester.element(find.byType(Scaffold).first);
    await tester.runAsync(() async {
      for (final url in urls) {
        await precacheImage(CachedNetworkImageProvider(url), context, onError: (e, _) => errors.add('$url: $e'));
      }
    });
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(errors, isEmpty);
    expect(find.byIcon(Icons.broken_image_outlined), findsNothing);
    return urls;
  }

  Future<void> shot(WidgetTester tester, String name) async {
    await tester.pump();
    await binding.takeScreenshot(name);
  }

  void go(WidgetTester tester, String location) =>
      GoRouter.of(tester.element(find.byType(Scaffold).first)).push(location);

  Widget app() => ProviderScope(
        overrides: [initialThemeModeProvider.overrideWithValue(ThemeMode.light)],
        child: const HatlyCustomerApp(),
      );

  testWidgets('signed out: the sign-in screen shows the supplied Hatly logo', (tester) async {
    await TokenStorage().clear();
    await tester.pumpWidget(app());
    // the SIGN-IN screen (not the splash, which shows the same logo while the session is restored)
    await waitFor(tester, find.byType(TextField));
    // the splash → sign-in transition briefly shows both screens' logos; wait until only the sign-in one remains
    final end = DateTime.now().add(const Duration(seconds: 30));
    while (find.byKey(const Key('hatly-logo')).evaluate().length != 1) {
      if (DateTime.now().isAfter(end)) fail('the sign-in screen never settled with exactly one logo');
      await tester.pump(const Duration(milliseconds: 100));
    }
    final logo = tester.widget<Image>(find.byKey(const Key('hatly-logo')));
    expect((logo.image as ResizeImage).imageProvider, const AssetImage(HatlyLogo.assetPath));
    // the logo's own image stream must deliver a decoded frame (not just exist in the tree)
    await tester.runAsync(() => precacheImage(logo.image, tester.element(find.byKey(const Key('hatly-logo')))));
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(find.text('هاتلي'), findsNothing); // the decode-failure fallback never shows
    await shot(tester, '01-sign-in-logo');
  });

  testWidgets('signed in: sectors, vendors, products and product details render the supplied images', (tester) async {
    // a real customer session, exactly what a login stores
    final phone = '+2010${DateTime.now().millisecondsSinceEpoch.toString().substring(5)}';
    final auth = await api('POST', '/auth/customer/password/register',
        body: {'phone': phone, 'fullName': 'Marketplace Smoke', 'password': 'Verify-Dev-1!'}) as Map<String, dynamic>;
    final token = auth['accessToken'] as String;
    await TokenStorage().saveTokens(accessToken: token, refreshToken: auth['refreshToken'] as String);
    final sectors = (await api('GET', '/sectors', token: token) as List).cast<Map<String, dynamic>>();
    final restaurants = sectors.firstWhere((s) => s['slug'] == 'restaurants');
    final vendors = (await api('GET', '/vendors?sectorId=${restaurants['id']}', token: token) as List).cast<Map<String, dynamic>>();
    final pizza = vendors.firstWhere((v) => '${v['name']} ${v['nameAr']}'.contains('Flatini') || '${v['name']}'.contains('فلاتيني'),
        orElse: () => vendors.first);

    await tester.pumpWidget(app());

    // Home: "Shop by category" sector tiles
    await waitFor(tester, find.text(restaurants['nameAr'] as String? ?? restaurants['name'] as String));
    final homeUrls = await expectAllImagesDecode(tester);
    expect(homeUrls.where((u) => u.contains('/marketplace/sectors/')).length, greaterThanOrEqualTo(4));
    await shot(tester, '02-home-sectors');

    // Restaurants → vendor list (logos: placeholder — no usable logo was supplied)
    go(tester, '/vendors?sectorId=${restaurants['id']}&sectorName=${Uri.encodeComponent(restaurants['nameAr'] as String? ?? '')}');
    await waitFor(tester, find.textContaining(RegExp('فلاتيني|Flatini')));
    await expectAllImagesDecode(tester);
    await shot(tester, '03-restaurant-vendors');

    // Vendor → its products
    go(tester, '/vendors/${pizza['id']}');
    await waitFor(tester, find.textContaining(RegExp('مارجريتا|Margherita')));
    final vendorUrls = await expectAllImagesDecode(tester);
    expect(vendorUrls.where((u) => u.contains('/marketplace/products/')), isNotEmpty);
    await shot(tester, '04-vendor-products');

    // Product details hero
    final page = await api('GET', '/vendor-branches/${pizza['id']}/products?limit=50', token: token);
    final products = (page is List ? page : (page['items'] ?? page['data']) as List).cast<Map<String, dynamic>>();
    final margherita = products.firstWhere((p) => '${p['name']}'.contains('Margherita') || '${p['nameAr']}'.contains('مارجريتا'));
    go(tester, '/products/${margherita['id']}');
    await waitFor(tester, find.byType(CachedNetworkImage));
    final detailUrls = await expectAllImagesDecode(tester);
    expect(detailUrls.any((u) => u.endsWith('/marketplace/products/flatini-pizza/margherita-pizza.webp')), isTrue);
    await shot(tester, '05-product-details');

    await TokenStorage().clear();
  });
}
