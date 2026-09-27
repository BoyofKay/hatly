import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../domain/home_content.dart';
import 'promo_cta_button.dart';

/// Rotating promo carousel: rounded (radius 20) inset cards, auto-rotate plus
/// manual swipe, page indicators, and a kind-specific CTA on a single shared
/// button component.
///
/// Auto-rotation pauses while the user is dragging, stops when the OS asks for
/// reduced motion (`MediaQuery.disableAnimations`) and never runs for a single
/// promo. It is presentation-only: [onAction] decides what a CTA does.
class PromoCarousel extends StatefulWidget {
  const PromoCarousel({
    super.key,
    required this.promos,
    required this.onAction,
    this.autoRotateInterval = const Duration(seconds: 5),
    this.height = 176,
  });

  final List<HomePromo> promos;
  final ValueChanged<HomePromo> onAction;
  final Duration autoRotateInterval;
  final double height;

  @override
  State<PromoCarousel> createState() => _PromoCarouselState();
}

class _PromoCarouselState extends State<PromoCarousel> {
  late final PageController _controller =
      PageController(viewportFraction: 0.92);
  Timer? _timer;
  int _page = 0;
  bool _reduceMotion = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduceMotion = MediaQuery.of(context).disableAnimations;
    _restartTimer();
  }

  @override
  void didUpdateWidget(PromoCarousel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.promos.length != widget.promos.length) {
      if (_page >= widget.promos.length) _page = 0;
      _restartTimer();
    }
  }

  void _restartTimer() {
    _timer?.cancel();
    _timer = null;
    if (_reduceMotion || widget.promos.length < 2) return;
    _timer = Timer.periodic(widget.autoRotateInterval, (_) {
      if (!mounted || !_controller.hasClients) return;
      final next = (_page + 1) % widget.promos.length;
      _controller.animateToPage(next,
          duration: const Duration(milliseconds: 350),
          curve: Curves.easeOutCubic);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

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
          SizedBox(
            height: widget.height * textScale,
            child: NotificationListener<ScrollNotification>(
              onNotification: (n) {
                // User is interacting → stop auto-rotation until they let go.
                if (n is ScrollStartNotification && n.dragDetails != null) {
                  _timer?.cancel();
                } else if (n is ScrollEndNotification) {
                  _restartTimer();
                }
                return false;
              },
              child: PageView.builder(
                controller: _controller,
                itemCount: promos.length,
                onPageChanged: (i) => setState(() => _page = i),
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
            flex: 6,
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
            flex: 4,
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
