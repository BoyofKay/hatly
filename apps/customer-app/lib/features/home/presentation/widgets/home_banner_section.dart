import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/home_hero_artwork.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../../shared_widgets/looping_pager.dart';
import '../../../../shared_widgets/skeleton_box.dart';
import '../../data/home_banners_providers.dart';
import '../../domain/home_banner.dart';
import '../../domain/home_content.dart';
import 'home_promo_actions.dart';
import 'promo_carousel.dart';

/// The hero banner is the biggest thing on Home: banner images are wide (2 : 1, 1200×600 recommended) and are shown cover-cropped in a
/// taller card (about 1.7 : 1) so the promotion is prominent on a phone, within a sane range so a tablet does not get a giant one.
const double kBannerAspect = 1.55;

double bannerHeight(double availableWidth) {
  // The card spans the content width (page margin on both sides); the height follows the card, as before (~210 pt on a 390 pt phone).
  return (availableWidth / kBannerAspect).clamp(156.0, 330.0);
}

/// The hero slot at the top of Home. Admin banners win when there are any; otherwise the offer-derived promos (the previous
/// behaviour) are shown, and when there is nothing at all the slot takes no space. A banner request that is loading shows a placeholder
/// of the same height (no jump); one that FAILS is not an error the customer needs to see — promotional images are optional — so it
/// falls back quietly. Never shows demo content unless the caller's promos are demo content (debug builds only).
class HomeBannerSection extends ConsumerWidget {
  const HomeBannerSection(
      {super.key, required this.fallbackPromos, required this.onPromoAction});

  final List<HomePromo> fallbackPromos;
  final ValueChanged<HomePromo> onPromoAction;


  Widget _fallback() => fallbackPromos.isEmpty
      ? const SizedBox.shrink()
      : Column(children: [
          PromoCarousel(promos: fallbackPromos, onAction: onPromoAction),
        ]);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final banners = ref.watch(homeBannersProvider);
    return banners.when(
      loading: () => const HomeBannerSkeleton(),
      error: (_, __) => _fallback(),
      data: (list) {
        if (list.isEmpty) return _fallback();
        return Column(children: [
          HomeBannerCarousel(
            banners: list,
            fullArtwork: HomePinnedSearchScope.extendedOf(context),
            onTap: (banner) {
              final arabic =
                  Localizations.localeOf(context).languageCode == 'ar';
              final route = bannerRoute(banner, arabic: arabic);
              if (route != null) context.push(route);
            },
          ),
        ]);
      },
    );
  }
}

class HomeBannerSkeleton extends StatelessWidget {
  const HomeBannerSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding:
          const EdgeInsets.symmetric(horizontal: HatlySpacing.screenPadding),
      child: LayoutBuilder(
        builder: (context, c) => SkeletonBox(
            key: const Key('home-banner-skeleton'),
            width: double.infinity,
            height: bannerHeight(c.maxWidth),
            borderRadius: HatlyRadius.heroBanner),
      ),
    );
  }
}

/// Swipeable banner images (no page dots — owner, 2026-11-11). Glides to the next banner every few seconds (paused while dragging, off when the OS asks for reduced
/// motion, never for a single banner). A tappable banner is announced as a button with its title; an informative one as an image.
class HomeBannerCarousel extends StatefulWidget {
  const HomeBannerCarousel({
    super.key,
    required this.banners,
    required this.onTap,
    this.autoRotateInterval = const Duration(seconds: 5),
    this.onIndexChanged,
    this.fullArtwork = false,
  });

  final bool fullArtwork;
  final List<HomeBanner> banners;
  final ValueChanged<HomeBanner> onTap;
  final ValueChanged<int>? onIndexChanged;
  final Duration autoRotateInterval;

  @override
  State<HomeBannerCarousel> createState() => _HomeBannerCarouselState();
}

class _HomeBannerCarouselState extends State<HomeBannerCarousel> {
  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final banners = widget.banners;
    if (banners.isEmpty) return const SizedBox.shrink();

    return Semantics(
      container: true,
      label: l10n.homePromoCarouselLabel,
      child: Column(
        children: [
          LayoutBuilder(
            builder: (context, constraints) => SizedBox(
              height: widget.fullArtwork ? constraints.maxWidth.clamp(240.0, 440.0).toDouble() : bannerHeight(constraints.maxWidth),
              // Endless in both directions; auto-play always glides forward (see LoopingPager).
              child: LoopingPager(
                count: banners.length,
                viewportFraction: 1.0,
                onIndexChanged: widget.onIndexChanged,
                autoPlayInterval: widget.autoRotateInterval,
                autoPlayGlide: const Duration(milliseconds: 900),
                autoPlayCurve: Curves.easeInOutCubic,
                itemBuilder: (context, index) {
                  final banner = banners[index];
                  final title = banner.displayTitle(arabic);
                  return Padding(
                    // Full-width page; the card is inset by exactly the page margin, so it lines up with the content below.
                    padding: EdgeInsets.zero,
                    child: Semantics(
                      button: banner.isTappable,
                      label: title,
                      excludeSemantics: true,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          borderRadius: const BorderRadius.vertical(bottom: Radius.circular(14)),
                          // A whisper of elevation — soft and restrained, not a floating card.
                          boxShadow: const [],
                        ),
                        child: Material(
                          color: Colors.transparent,
                          borderRadius: const BorderRadius.vertical(bottom: Radius.circular(14)),
                          clipBehavior: Clip.antiAlias,
                          child: InkWell(
                            key: Key('home-banner-${banner.id}'),
                            onTap: banner.isTappable
                                ? () => widget.onTap(banner)
                                : null,
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                // A failed or missing image shows the quiet placeholder (never a broken-image icon or an exception).
                                if (widget.fullArtwork)
                                  HatlySoftImage(url: banner.imageUrl, width: double.infinity, height: double.infinity, radius: 0, placeholderIcon: Icons.local_offer_outlined)
                                else HomeHeroArtwork(url: banner.imageUrl, alignment: Alignment.bottomCenter),
                                if (title.isNotEmpty) ...[
                                  // A soft scrim so the title stays readable on any picture.
                                  const Positioned.fill(
                                    child: DecoratedBox(
                                      decoration: BoxDecoration(
                                        gradient: LinearGradient(
                                          begin: Alignment.topCenter,
                                          end: Alignment.bottomCenter,
                                          stops: [0.45, 1.0],
                                          colors: [
                                            Color(0x00000000),
                                            Color(0x99000000)
                                          ],
                                        ),
                                      ),
                                    ),
                                  ),
                                  Positioned(
                                    left: HatlySpacing.md,
                                    right: HatlySpacing.md,
                                    bottom: HatlySpacing.md,
                                    child: Text(title,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: context.type.title.copyWith(
                                            color: Colors.white,
                                            fontWeight: FontWeight.w800)),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}
