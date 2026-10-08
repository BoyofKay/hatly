import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/config/api_config.dart';
import 'package:hatly_customer/core/storage/token_storage.dart';
import 'package:hatly_customer/core/theme/theme_mode_provider.dart';
import 'package:hatly_customer/main.dart';
import 'package:integration_test/integration_test.dart';

/// On-device tester smoke test: the Customer Tester signs in through the REAL sign-in screen, then a cart with products
/// from TWO vendors goes through the REAL checkout screen to a placed multi-vendor order — the flow that used to stop at
/// "الطلب من أكثر من متجر غير متاح حاليًا". Needs a backend seeded with the tester accounts (`npm run seed:dev-marketplace`
/// with TESTER_PASSWORD); the password is passed at run time, never stored in the app:
///
///   flutter drive -d <device> --driver=test_driver/integration_test.dart \
///     --target=integration_test/tester_multivendor_checkout_test.dart \
///     --dart-define=API_BASE_URL=http://localhost:3000/api/v1 --dart-define=TESTER_PASSWORD=...
const _testerPhoneLocal = '1070000001'; // +20 1070000001 — the seeded Customer Tester
const _testerPassword = String.fromEnvironment('TESTER_PASSWORD');

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  Future<dynamic> api(String method, String path, String token, {Object? body}) async {
    final client = HttpClient();
    try {
      final request = await client.openUrl(method, Uri.parse('$kApiBaseUrl$path'));
      request.headers.contentType = ContentType.json;
      request.headers.set('authorization', 'Bearer $token');
      if (body != null) request.write(jsonEncode(body));
      final response = await request.close();
      final text = await response.transform(utf8.decoder).join();
      if (response.statusCode >= 300) throw StateError('$method $path → ${response.statusCode} $text');
      return text.isEmpty ? null : (jsonDecode(text) as Map<String, dynamic>)['data'];
    } finally {
      client.close();
    }
  }

  Future<void> waitFor(WidgetTester tester, Finder finder, {Duration timeout = const Duration(seconds: 30)}) async {
    final end = DateTime.now().add(timeout);
    while (finder.evaluate().isEmpty) {
      if (DateTime.now().isAfter(end)) fail('timed out waiting for $finder');
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  testWidgets('Customer Tester: real sign-in, then a TWO-vendor cart checks out into one multi-vendor order', (tester) async {
    expect(_testerPassword, isNotEmpty, reason: 'pass --dart-define=TESTER_PASSWORD=...');
    await TokenStorage().clear();
    await tester.pumpWidget(ProviderScope(
      overrides: [initialThemeModeProvider.overrideWithValue(ThemeMode.light)],
      child: const HatlyCustomerApp(),
    ));

    // 1. the real sign-in screen: name + phone → the backend switches to password mode → "I already have a password"
    await waitFor(tester, find.byType(TextField));
    await tester.enterText(find.byType(TextField).at(0), 'Hatly Customer Tester');
    await tester.enterText(find.byType(TextField).at(1), _testerPhoneLocal);
    await tester.tap(find.text('متابعة'));
    await waitFor(tester, find.text('هل لديك كلمة مرور بالفعل؟ سجّل الدخول بدلاً من ذلك'));
    await tester.tap(find.text('هل لديك كلمة مرور بالفعل؟ سجّل الدخول بدلاً من ذلك'));
    await tester.pump(const Duration(milliseconds: 300));
    final passwordField = find.byWidgetPredicate((w) => w is TextField && w.obscureText);
    await tester.enterText(passwordField, _testerPassword);
    await tester.tap(find.text('متابعة'));
    await waitFor(tester, find.text('تسوّق حسب الفئة')); // Home: signed in
    final token = (await TokenStorage().accessToken)!;

    // 2. a cart with products from two vendors (the same cart that used to be refused)
    await api('DELETE', '/cart', token);
    final restaurants = ((await api('GET', '/sectors', token)) as List).cast<Map<String, dynamic>>().firstWhere((s) => s['slug'] == 'restaurants');
    final vendors = ((await api('GET', '/vendors?sectorId=${restaurants['id']}', token)) as List).cast<Map<String, dynamic>>();
    Future<String> productOf(String vendorName, String productName) async {
      final v = vendors.firstWhere((x) => x['name'] == vendorName);
      final page = await api('GET', '/vendor-branches/${v['id']}/products?limit=50', token);
      final products = (page is List ? page : (page['items'] ?? page['data']) as List).cast<Map<String, dynamic>>();
      return products.firstWhere((p) => p['name'] == productName)['id'] as String;
    }
    await api('POST', '/cart/items', token, body: {'productId': await productOf('Abu Aly Grills', 'Kebab'), 'quantity': 1});
    await api('POST', '/cart/items', token, body: {'productId': await productOf('Beit El Sharkia Restaurant', 'Mixed Grill'), 'quantity': 1});

    // 3. the real checkout screen: no multi-vendor block, both vendors listed
    GoRouter.of(tester.element(find.byType(Scaffold).first)).push('/checkout');
    await waitFor(tester, find.byKey(const Key('checkout-confirm')));
    // the checkout recognises the TWO-vendor cart (pickup is offered for single-vendor orders only) and is NOT blocked
    await waitFor(tester, find.text('الاستلام من الفرع متاح لطلب من متجر واحد فقط'));
    expect(find.text('الطلب من أكثر من متجر غير متاح حاليًا'), findsNothing);
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100)); // let the route transition finish before the screenshot
    }
    await binding.takeScreenshot('10-multivendor-checkout');

    // 4. place it through the UI → the success screen; the backend holds ONE order with TWO vendor segments
    await tester.scrollUntilVisible(find.byKey(const Key('checkout-confirm')), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const Key('checkout-confirm')));
    await waitFor(tester, find.byKey(const Key('success-title')));
    await binding.takeScreenshot('11-multivendor-order-placed');
    final orders = ((await api('GET', '/orders?tab=active', token)) as List).cast<Map<String, dynamic>>();
    final latest = await api('GET', '/orders/${orders.first['id']}', token) as Map<String, dynamic>;
    expect((latest['segments'] as List).length, 2);
  });
}
