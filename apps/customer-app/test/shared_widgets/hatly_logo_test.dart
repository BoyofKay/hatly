import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/auth/presentation/screens/splash_screen.dart';
import 'package:hatly_customer/shared_widgets/hatly_logo.dart';

import '../support/test_app.dart';

/// The supplied Hatly logo is bundled as a real asset and is what the splash shows — not the old text placeholder.
void main() {
  test('the supplied logo is a bundled, declared asset (a real 1536×1536 JPEG)', () async {
    TestWidgetsFlutterBinding.ensureInitialized();
    final data = await rootBundle.load(HatlyLogo.assetPath);
    final bytes = data.buffer.asUint8List();
    expect(bytes.length, 120478); // byte-for-byte the supplied hatly-logo.jpg
    expect(bytes.sublist(0, 3), [0xFF, 0xD8, 0xFF]); // JPEG
  });

  testWidgets('the splash shows the logo image (and no longer the plain "هاتلي" text)', (tester) async {
    await tester.pumpWidget(hatlyTestApp(const SplashScreen()));
    await tester.pump();
    final image = tester.widget<Image>(find.byKey(const Key('hatly-logo')));
    // decoded at the displayed size (cacheWidth) from the bundled asset
    expect((image.image as ResizeImage).imageProvider, const AssetImage(HatlyLogo.assetPath));
    expect(find.text('هاتلي'), findsNothing); // the fallback text appears only if the image cannot decode
  });

  testWidgets('the logo decodes for real (no error fallback)', (tester) async {
    await tester.runAsync(() async {
      await tester.pumpWidget(hatlyTestApp(const Center(child: HatlyLogo())));
      final element = tester.element(find.byType(HatlyLogo));
      await precacheImage(const AssetImage(HatlyLogo.assetPath), element);
    });
    await tester.pump();
    expect(find.text('هاتلي'), findsNothing);
    expect(find.bySemanticsLabel('Hatly'), findsOneWidget);
  });
}
