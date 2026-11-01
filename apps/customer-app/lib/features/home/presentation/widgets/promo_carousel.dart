import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../../shared_widgets/looping_pager.dart';
import '../../domain/home_content.dart';
import 'promo_cta_button.dart';

/// Rotating promo carousel: rounded (radius 20) inset cards, auto-rotate plus
/// manual swipe, page indicators, and a kind-specific CTA on a single shared
/// button component.
///
/// Auto-rotation pauses while the user is dragging, stops when the OS asks for
/// reduced motion (`MediaQuery.disableAnimations`) and never runs for a single
/// promo. It is presentation-only: [onAction] decides what a CTA does.
/// The hero banner's proportions: each card is about 1.6 : 1 (it used to be ~2 : 1, a thin strip), within a sane range so a
/// tablet does not get a giant banner and a small phone still gets a full-size one.
const double kPromoBannerAspect = 1.5;
const double kPromoViewportFraction = 0.92;
const double kPromoBannerMinHeight = 210;
const double kPromoBannerMaxHeight = 320;

double promoBannerHeight(double availableWidth) {
  final cardWidth =
      availableWidth * kPromoViewportFraction - 2 * HatlySpacing.xs;
  return (cardWidth / kPromoBannerAspect)
      .clamp(kPromoBannerMinHeight, kPromoBannerMaxHeight);
}

class PromoCarousel extends StatefulWidget {
  const PromoCarousel({
    super.key,
    required this.promos,
    required this.onAction,
    this.autoRotateInterval = const Duration(seconds: 5),
    this.height,
  });

  final List<HomePromo> promos;
  final ValueChanged<HomePromo> onAction;
  final Duration autoRotateInterval;

  /// A fixed height (tests / special layouts). Null = the banner's own proportions, from the screen width
  /// ([promoBannerHeight]).
  final double? height;

  @override
  State<PromoCarousel> createState() => _PromoCarouselState();
}

class _PromoCarouselState extends State<PromoCarousel> {
  int _page = 0;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final promos = widget.promos;
    if (promos.isEmpty) return const SizedBox.shrink();

    // The card grows with the user's text size so larger accessibility text never clips.
    final textScale =
        (MediaQuery.textScalerOf(context).scale(16) / 16).clamp(1.0, 2.0);

    return Semantics(
      container: true,
      label: l10n.homePromoCarouselLabel,
      child: Column(
        children: [
          LayoutBuilder(
            builder: (context, constraints) => SizedBox(
              height:
                  (widget.height ?? promoBannerHeight(constraints.maxWidth)) *
                      textScale,
              // Endless in both directions; auto-play always glides forward (see LoopingPager).
              child: LoopingPager(
                count: promos.length,
                viewportFraction: kPromoViewportFraction,
                autoPlayInterval: widget.autoRotateInterval,
                onIndexChanged: (i) => setState(() => _page = i),
                itemBuilder: (context, index) => Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: HatlySpacing.xs),
                  child: _PromoCard(
                      promo: promos[index],
                      onAction: () => widget.onAction(promos[index])),
                ),
              ),
            ),
          ),
          if (promos.length > 1) ...[
            const SizedBox(height: HatlySpacing.sm),
            PromoPageIndicator(count: promos.length, index: _page),
          ],
        ],
      ),
    );
  }
}

class _PromoCard extends StatelessWidget {
  const _PromoCard({required this.promo, required this.onAction});

  final HomePromo promo;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final ctaLabel = promoCtaLabel(l10n, promo.kind);

    return Container(
      decoration: BoxDecoration(
        // Subtle brand tint over the surface, no shadow — the calm main
        // commercial element, not a flat orange banner.
        color: Color.alphaBlend(p.accentSoft, p.surface),
        borderRadius: BorderRadius.circular(HatlyRadius.promoBanner),
      ),
      padding: const EdgeInsets.all(HatlySpacing.md),
      child: Row(
        children: [
          Expanded(
            flex: 5,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(promo.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: context.type.title),
                if (promo.subtitle != null) ...[
                  const SizedBox(height: HatlySpacing.xs),
                  Text(promo.subtitle!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.type.small),
                ],
                const SizedBox(height: HatlySpacing.ms),
                PromoCtaButton(label: ctaLabel, onPressed: onAction),
              ],
            ),
          ),
          const SizedBox(width: HatlySpacing.md),
          Expanded(
            flex: 5,
            child: HatlySoftImage(
              url: promo.imageUrl,
              width: double.infinity,
              height: double.infinity,
              placeholderIcon: Icons.local_offer_outlined,
              semanticLabel: promo.title,
            ),
          ),
        ],
      ),
    );
  }
}

/// Dots where the active one is a longer pill — position is readable by shape,
/// not only by colour.
class PromoPageIndicator extends StatelessWidget {
  const PromoPageIndicator(
      {super.key, required this.count, required this.index});

  final int count;
  final int index;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return Semantics(
      label: l10n.homePromoPageIndicator(index + 1, count),
      excludeSemantics: true,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          for (var i = 0; i < count; i++)
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              margin: const EdgeInsets.symmetric(horizontal: 3),
              width: i == index ? 20 : 8,
              height: 8,
              decoration: BoxDecoration(
                color: i == index ? p.accent : p.border,
                borderRadius: BorderRadius.circular(HatlyRadius.circular),
              ),
            ),
        ],
      ),
    );
  }
}
