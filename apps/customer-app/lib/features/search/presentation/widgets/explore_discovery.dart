import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_section_header.dart';
import '../../../../shared_widgets/skeleton_box.dart';
import '../../../home/data/home_providers.dart';
import '../../../home/domain/home_content.dart';
import '../../../home/presentation/widgets/home_category_section.dart';
import '../../../home/presentation/widgets/home_horizontal_row.dart';
import '../../../home/presentation/widgets/home_offers_section.dart';
import '../../../home/presentation/widgets/home_promo_actions.dart';
import '../../../products/presentation/widgets/product_card.dart';
import '../../../vendors/domain/vendor.dart';
import '../../../vendors/presentation/widgets/vendor_cover_card.dart';
import '../../data/explore_content_config.dart';
import '../../data/explore_logic.dart';
import '../../data/explore_providers.dart';
import 'explore_message.dart';
import 'featured_category_row.dart';

/// The Explore discovery page (shown while the search box is empty):
/// Shop by Category → Featured categories → Featured vendors → Offers →
/// New on Hatly. Everything is composed from the EXISTING sources (sectors,
/// the vendor/product listings via `homeSnapshotProvider`, and the newest-vendor
/// listing); sections without data disappear rather than showing placeholders.
class ExploreDiscovery extends StatelessWidget {
  const ExploreDiscovery({super.key});

  static const double sectionGap = HatlySpacing.xl;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding:
          const EdgeInsets.only(top: HatlySpacing.md, bottom: HatlySpacing.lg),
      children: const [
        ExploreCategoriesSection(),
        _LowerSections(),
      ],
    );
  }
}

/// Shop by Category on Explore: the Home grid language, collapsed to the first
/// [kExploreInitialCategoryCount] categories. When more exist, "عرض الكل ←"
/// expands the grid in place to every available category and "عرض أقل"
/// collapses it again — Explore IS the destination, so it never navigates away
/// from itself.
class ExploreCategoriesSection extends ConsumerStatefulWidget {
  const ExploreCategoriesSection({super.key});

  @override
  ConsumerState<ExploreCategoriesSection> createState() =>
      _ExploreCategoriesSectionState();
}

class _ExploreCategoriesSectionState
    extends ConsumerState<ExploreCategoriesSection> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final categoriesAsync = ref.watch(homeCategoriesProvider);

    return categoriesAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.only(bottom: ExploreDiscovery.sectionGap),
        child: CategoryGridSkeleton(),
      ),
      error: (error, stackTrace) => SizedBox(
        height: 220,
        child: ExploreMessage(
          icon: Icons.wifi_off_rounded,
          title: l10n.exploreLoadFailed,
          retryLabel: l10n.retry,
          onRetry: () => ref.invalidate(homeCategoriesProvider),
        ),
      ),
      data: (categories) {
        if (categories.isEmpty) return const SizedBox.shrink();
        final hasMore = categories.length > kExploreInitialCategoryCount;
        final shown = _expanded
            ? categories
            : categories.take(kExploreInitialCategoryCount).toList();
        final featured = featuredCategories(categories);

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            HatlySectionHeader(
              title: l10n.homeSectionCategories,
              seeAllLabel: hasMore
                  ? (_expanded ? l10n.exploreSeeLess : l10n.seeAll)
                  : null,
              onSeeAll:
                  hasMore ? () => setState(() => _expanded = !_expanded) : null,
            ),
            const SizedBox(height: HatlySpacing.sm),
            // Reference board ("الأقسام"): two large photo cards per row.
            CategoryGrid(categories: shown, columns: 2, large: true),
            if (featured.isNotEmpty) ...[
              const SizedBox(height: ExploreDiscovery.sectionGap),
              HatlySectionHeader(title: l10n.exploreSectionFeaturedCategories),
              const SizedBox(height: HatlySpacing.xs),
              FeaturedCategoryRow(categories: featured),
            ],
            const SizedBox(height: ExploreDiscovery.sectionGap),
          ],
        );
      },
    );
  }
}

/// Featured vendors, Offers and New on Hatly.
class _LowerSections extends ConsumerWidget {
  const _LowerSections();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final snapshotAsync = ref.watch(homeSnapshotProvider);
    // A failing "new vendors" call only removes that part of the section.
    final newVendors =
        ref.watch(exploreNewVendorsProvider).valueOrNull ?? const <Vendor>[];

    return snapshotAsync.when(
      loading: () => const _LowerSkeleton(),
      error: (error, stackTrace) => SizedBox(
        height: 220,
        child: ExploreMessage(
          icon: Icons.wifi_off_rounded,
          title: l10n.exploreLoadFailed,
          retryLabel: l10n.retry,
          onRetry: () {
            ref.invalidate(homeSnapshotProvider);
            ref.invalidate(exploreNewVendorsProvider);
          },
        ),
      ),
      data: (snapshot) {
        final newProducts = [
          for (final e in snapshot.productEntries)
            if (e.tag == HomeProductTag.newItem) e,
        ];
        final hasNew = newVendors.isNotEmpty || newProducts.isNotEmpty;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (snapshot.popularVendors.isNotEmpty) ...[
              HatlySectionHeader(title: l10n.exploreSectionFeaturedVendors),
              const SizedBox(height: HatlySpacing.xs),
              VendorRow(
                  vendors: snapshot.popularVendors,
                  onTap: (v) => context.push(vendorRoute(v.id))),
              const SizedBox(height: ExploreDiscovery.sectionGap),
            ],
            if (snapshot.offers.isNotEmpty) ...[
              // No "عرض الكل": there is no offers listing to open.
              HomeOffersSection(
                offers: snapshot.offers,
                onOfferTap: (offer) => context.push(offerRoute(offer)),
                onQuickAdd: (offer) =>
                    handleQuickAdd(context, ref, offer.targetId!),
              ),
              const SizedBox(height: ExploreDiscovery.sectionGap),
            ],
            if (hasNew) ...[
              HatlySectionHeader(title: l10n.exploreSectionNew),
              const SizedBox(height: HatlySpacing.xs),
              if (newVendors.isNotEmpty)
                VendorRow(
                    vendors: newVendors,
                    onTap: (v) => context.push(vendorRoute(v.id))),
              if (newVendors.isNotEmpty && newProducts.isNotEmpty)
                const SizedBox(height: HatlySpacing.sm),
              if (newProducts.isNotEmpty)
                HomeHorizontalRow(
                  itemCount: newProducts.length,
                  itemBuilder: (context, i, width) => ProductCard(
                    product: newProducts[i].product,
                    width: width,
                    elevated: false,
                    onTap: () =>
                        context.push(productRoute(newProducts[i].product.id)),
                    onQuickAdd: () =>
                        handleQuickAdd(context, ref, newProducts[i].product.id),
                  ),
                ),
            ],
          ],
        );
      },
    );
  }
}

/// A horizontal row of commercial vendor cards (~1.35 visible so the next one
/// peeks in). Ratings/ETA/offer badge appear on the card only when real.
class VendorRow extends StatelessWidget {
  const VendorRow({super.key, required this.vendors, required this.onTap});

  final List<Vendor> vendors;
  final ValueChanged<Vendor> onTap;

  @override
  Widget build(BuildContext context) {
    return HomeHorizontalRow(
      visibleCards: 1.35,
      itemCount: vendors.length,
      itemBuilder: (context, i, width) => SizedBox(
        width: width,
        child:
            VendorCoverCard(vendor: vendors[i], onTap: () => onTap(vendors[i])),
      ),
    );
  }
}

class _LowerSkeleton extends StatelessWidget {
  const _LowerSkeleton();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(horizontal: HatlySpacing.screenPadding),
      child: Column(
        children: [
          SkeletonBox(
              width: double.infinity,
              height: 190,
              borderRadius: HatlyRadius.card),
          SizedBox(height: HatlySpacing.lg),
          SkeletonBox(
              width: double.infinity,
              height: 210,
              borderRadius: HatlyRadius.card),
        ],
      ),
    );
  }
}
