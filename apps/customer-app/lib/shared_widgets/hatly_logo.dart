import 'package:flutter/material.dart';

import '../core/theme/hatly_theme.dart';

/// The supplied Hatly brand logo (`assets/images/hatly-logo.jpg` — the canonical brand asset, bundled unchanged).
/// Shown on a rounded white card so it reads the same on the orange splash and on light/dark surfaces. The bundled
/// image cannot go missing at runtime, but a decode failure still falls back to the app name, never a broken image.
class HatlyLogo extends StatelessWidget {
  const HatlyLogo({super.key, this.size = 96});

  static const assetPath = 'assets/images/hatly-logo.jpg';

  final double size;

  @override
  Widget build(BuildContext context) {
    // Decode at the displayed size, not the full 1536 px source: it paints on the first frames (no empty card on the
    // short-lived splash) and holds far less memory. The asset file itself is unchanged.
    final decodeWidth = (size * MediaQuery.devicePixelRatioOf(context)).round();
    return Semantics(
      label: 'Hatly',
      image: true,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(size * 0.22),
        child: ColoredBox(
          color: HatlyColors.surfaceWhite,
          child: Image.asset(
            assetPath,
            key: const Key('hatly-logo'),
            width: size,
            height: size,
            cacheWidth: decodeWidth,
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) => SizedBox(
              width: size,
              height: size,
              child: Center(
                child: Text('هاتلي',
                    style: TextStyle(
                        color: HatlyColors.primaryOrange,
                        fontSize: size * 0.28,
                        fontWeight: FontWeight.bold)),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
