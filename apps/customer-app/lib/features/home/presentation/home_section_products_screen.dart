import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_badge.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_soft_image.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../products/presentation/widgets/product_grid_card.dart';
import '../data/home_banners_providers.dart';
import '../data/home_providers.dart';
import '../domain/home_banner.dart';
import '../domain/home_content.dart';
import 'widgets/home_promo_actions.dart';

/// The full list behind a Home section's "See all" — "Most ordered", "New" or "Offers". It shows exactly the products the
/// section's own definition accepts (`loadHomeSection`): never the generic search page, never a product that is only there
/// because a sort happened to put it first. Loading, empty and error states are explicit; tapping a product opens its details.
class HomeSectionProductsScreen extends ConsumerWidget {
  const HomeSectionProductsScreen({super.key, required this.kind});

  final HomeSectionKind kind;

  static String titleOf(AppLocalizations l10n, HomeSectionKind kind) {
    switch (kind) {
      case HomeSectionKind.mostOrdered:
        return l10n.homeSectionMostOrdered;
      case HomeSectionKind.newest:
        return l10n.homeSectionNew;
      case HomeSectionKind.offers:
        return l10n.homeSeeAllOffersTitle;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final async = ref.watch(homeSectionProductsProvider(kind));
    return Scaffold(
      appBar: AppBar(title: Text(titleOf(l10n, kind))),
      body: SafeArea(
        child: async.when(
          loading: () => const HatlyLoadingView(),
          error: (_, __) => HatlyStateView(
            icon: Icons.error_outline,
            title: l10n.somethingWentWrong,
            retryLabel: l10n.retry,
            onRetry: () => ref.invalidate(homeSectionProductsProvider(kind)),
          ),
          data: (entries) {
            final banners = kind == HomeSectionKind.offers
                ? ref.watch(homeBannersProvider).valueOrNull ??
                    const <HomeBanner>[]
                : const <HomeBanner>[];
            if (entries.isEmpty) {
              final empty = HatlyStateView(
                  key: const Key('home-section-empty'),
                  icon: Icons.inbox_outlined,
                  title: l10n.homeSeeAllEmpty);
              if (banners.isEmpty) return empty;
              // No offer products right now, but the admin's promotions still lead the page.
              return ListView(
                padding: const EdgeInsets.all(HatlySpacing.screenPadding),
                children: [
                  for (final banner in banners) ...[
                    _OfferBannerCard(banner: banner),
                    const SizedBox(height: HatlySpacing.md),
                  ],
                ],
              );
            }
            return RefreshIndicator(
                onRefresh: () async {
                  ref.invalidate(homeSectionProductsProvider(kind));
                  await ref
                      .read(homeSectionProductsProvider(kind).future)
                      .catchError((_) => <HomeProductEntry>[]);
                },
                child: SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(HatlySpacing.screenPadding),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Reference board ("العروض والكوبونات"): the admin's promotion banners lead the offers page, stacked as large
                      // cards; nothing is shown when there are none (never a placeholder banner).
                      for (final banner in banners) ...[
                        _OfferBannerCard(banner: banner),
                        const SizedBox(height: HatlySpacing.md),
                      ],
                      TwoColumnRows(
                        children: [
                          for (final entry in entries)
                            ProductGridCard(
                              key: Key('home-section-product-${entry.product.id}'),
                              product: entry.product,
                              extraBadge: entry.tag == HomeProductTag.newItem
                                  ? HatlyBadgeKind.newItem : null,
                              onTap: () => context.push(productRoute(entry.product.id)),
                              onQuickAdd: () => handleQuickAdd(
                                context, ref, entry.product.id),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
          },
        ),
      ),
    );
  }
}

class _OfferBannerCard extends StatelessWidget {
  const _OfferBannerCard({required this.banner});

  final HomeBanner banner;

  @override
  Widget build(BuildContext context) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final title =
        arabic && banner.titleAr != null ? banner.titleAr! : banner.title;
    final route = bannerRoute(banner, arabic: arabic);
    return Semantics(
      button: route != null,
      label: title,
      excludeSemantics: true,
      child: InkWell(
        key: Key('offers-banner-${banner.id}'),
        borderRadius: BorderRadius.circular(HatlyRadius.promoBanner),
        onTap: route == null ? null : () => context.push(route),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(HatlyRadius.promoBanner),
          child: AspectRatio(
            aspectRatio: 2.4,
            child: Stack(
              fit: StackFit.expand,
              children: [
                HatlySoftImage(
                    url: banner.imageUrl,
                    width: double.infinity,
                    height: double.infinity,
                    radius: 0,
                    placeholderIcon: Icons.local_offer_outlined),
                const DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Colors.transparent, Color(0x99000000)],
                    ),
                  ),
                ),
                PositionedDirectional(
                  start: HatlySpacing.md,
                  end: HatlySpacing.md,
                  bottom: HatlySpacing.ms,
                  child: Text(title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: context.type.title.copyWith(
                          color: Colors.white, fontWeight: FontWeight.w800)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A "See all" link whose section is not one of the three known ones: the app's own not-found treatment, not a blank page.
class HomeSectionUnknown extends StatelessWidget {
  const HomeSectionUnknown({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(),
      body: HatlyStateView(
        icon: Icons.error_outline,
        title: l10n.routeNotFoundTitle,
        retryLabel: l10n.checkoutSuccessBackHome,
        onRetry: () => context.go('/'),
      ),
    );
  }
}
