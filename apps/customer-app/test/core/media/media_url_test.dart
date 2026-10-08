import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/media/media_url.dart';
import 'package:hatly_customer/shared_widgets/hatly_image.dart';
import 'package:hatly_customer/shared_widgets/hatly_soft_image.dart';

import '../../support/test_app.dart';

void main() {
  const base = 'https://api.example.test/api/v1';

  group('resolveMediaUrl', () {
    test('null, blank and whitespace resolve to null (placeholder path)', () {
      expect(resolveMediaUrl(null, apiBaseUrl: base), isNull);
      expect(resolveMediaUrl('', apiBaseUrl: base), isNull);
      expect(resolveMediaUrl('   ', apiBaseUrl: base), isNull);
    });

    test('absolute http(s) URLs pass through untouched', () {
      expect(
          resolveMediaUrl('https://cdn.example.test/a/b.webp',
              apiBaseUrl: base),
          'https://cdn.example.test/a/b.webp');
      expect(resolveMediaUrl('http://cdn.example.test/a.jpg', apiBaseUrl: base),
          'http://cdn.example.test/a.jpg');
    });

    test('server-relative paths resolve against the API origin, not /api/v1',
        () {
      expect(
          resolveMediaUrl('/uploads/files/marketplace/sectors/pharmacy.webp',
              apiBaseUrl: base),
          'https://api.example.test/uploads/files/marketplace/sectors/pharmacy.webp');
      expect(
          resolveMediaUrl('/uploads/files/x.jpg',
              apiBaseUrl: 'http://10.0.0.5:3000/api/v1'),
          'http://10.0.0.5:3000/uploads/files/x.jpg');
    });

    test(
        'non-http schemes, bare relative strings and protocol-relative URLs resolve to null',
        () {
      expect(resolveMediaUrl('stub-upload://abc', apiBaseUrl: base), isNull);
      expect(resolveMediaUrl('file:///etc/passwd', apiBaseUrl: base), isNull);
      expect(resolveMediaUrl('uploads/files/x.jpg', apiBaseUrl: base), isNull);
      expect(resolveMediaUrl('//evil.example.test/x.jpg', apiBaseUrl: base),
          isNull);
      expect(resolveMediaUrl('http://', apiBaseUrl: base), isNull);
    });

    test('an unusable API base URL never produces a bogus absolute URL', () {
      expect(resolveMediaUrl('/uploads/files/x.jpg', apiBaseUrl: 'not a url'),
          isNull);
    });
  });

  group('image widgets use the resolver', () {
    for (final bad in <String?>[null, '', 'stub-upload://x', 'uploads/x.jpg']) {
      testWidgets(
          'HatlyImage with ${bad == null ? 'null' : "'$bad'"} shows the placeholder, no network image',
          (tester) async {
        await tester.pumpWidget(
            hatlyTestApp(HatlyImage(url: bad, width: 40, height: 40)));
        expect(find.byType(CachedNetworkImage), findsNothing);
        expect(find.byIcon(Icons.shopping_bag_outlined), findsOneWidget);
      });

      testWidgets(
          'HatlySoftImage with ${bad == null ? 'null' : "'$bad'"} shows the placeholder, no network image',
          (tester) async {
        await tester.pumpWidget(
            hatlyTestApp(HatlySoftImage(url: bad, width: 40, height: 40)));
        expect(find.byType(CachedNetworkImage), findsNothing);
      });
    }

    testWidgets('a server-relative path is requested as an absolute URL',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(const Column(children: [
        HatlyImage(
            url: '/uploads/files/marketplace/vendors/a.webp',
            width: 40,
            height: 40),
        HatlySoftImage(
            url: '/uploads/files/marketplace/vendors/a.webp',
            width: 40,
            height: 40),
      ])));
      final images = tester
          .widgetList<CachedNetworkImage>(find.byType(CachedNetworkImage))
          .toList();
      expect(images, hasLength(2));
      for (final image in images) {
        expect(Uri.parse(image.imageUrl).hasScheme, isTrue);
        expect(image.imageUrl,
            endsWith('/uploads/files/marketplace/vendors/a.webp'));
        expect(image.imageUrl, isNot(contains('/api/v1/uploads')));
      }
    });
  });
}
