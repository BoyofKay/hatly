import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/hatly_badge.dart';
import '../../../../shared_widgets/hatly_section_header.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../../home/presentation/widgets/home_category_section.dart';
import '../../../sectors/domain/sector.dart';
import '../../../vendors/domain/vendor.dart';
import '../../../vendors/presentation/widgets/vendor_cover_card.dart';
import '../../data/search_api.dart';
import '../../data/search_controller.dart';
import 'explore_message.dart';

/// Search results on Explore: category matches (local), then the real backend
/// vendor and product results. Navigation is exactly what it was: vendor →
/// `/vendors/:id`, product → `/products/:id`, category →
/// `/vendors?sectorId=…&sectorName=…`.
class ExploreSearchResults extends StatelessWidget {
  const ExploreSearchResults({
    super.key,
    required this.state,
    required this.matchedCategories,
    required this.onRetry,
  });

  final SearchState state;
  final List<MarketplaceSector> matchedCategories;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final results = state.results;
    final loading = state.status == SearchStatus.loading;
    final failed = state.status == SearchStatus.error;
    final vendors = results?.vendors.data ?? const <SearchVendorResult>[];
    final products = results?.products.data ?? const <SearchProductResult>[];
    final hasCategories = matchedCategories.isNotEmpty;

    // One clear overall message — never stacked empty states.
    if (state.status == SearchStatus.loaded &&
        !hasCategories &&
        vendors.isEmpty &&
        products.isEmpty) {
      return ExploreMessage(
          icon: Icons.search_off_rounded,
          title: l10n.searchNoResultsForQuery(state.query));
    }
    if (failed && !hasCategories) {
      return ExploreMessage(
        icon: Icons.wifi_off_rounded,
        title: l10n.somethingWentWrong,
        retryLabel: l10n.retry,
        onRetry: onRetry,
      );
    }
    if (loading && !hasCategories) {
      return Center(child: CircularProgressIndicator(color: p.accent));
    }

    return ListView(
      padding:
          const EdgeInsets.only(top: HatlySpacing.md, bottom: HatlySpacing.lg),
      children: [
        if (hasCategories) ...[
          HatlySectionHeader(title: l10n.exploreSearchCategories),
          const SizedBox(height: HatlySpacing.sm),
          CategoryGrid(categories: matchedCategories),
          const SizedBox(height: HatlySpacing.xl),
        ],
        if (loading)
          const Padding(
            padding: EdgeInsets.all(HatlySpacing.lg),
            child: Center(child: CircularProgressIndicator()),
          ),
        if (failed)
          SizedBox(
            height: 200,
            child: ExploreMessage(
              icon: Icons.wifi_off_rounded,
              title: l10n.somethingWentWrong,
              retryLabel: l10n.retry,
              onRetry: onRetry,
            ),
          ),
        if (vendors.isNotEmpty) ...[
          HatlySectionHeader(title: l10n.searchSectionVendors),
          const SizedBox(height: HatlySpacing.sm),
          Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: HatlySpacing.screenPadding),
            child: Column(
              children: [
                for (var i = 0; i < vendors.length; i++) ...[
                  if (i > 0) const SizedBox(height: HatlySpacing.md),
                  VendorCoverCard(
                    // Shorter cover than the discovery cards: a results list
                    // should be quick to scan.
                    coverHeight: 96,
                    vendor: vendors[i].toVendor(),
                    onTap: () => context.push('/vendors/${vendors[i].id}'),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: HatlySpacing.xl),
        ],
        if (products.isNotEmpty) ...[
          HatlySectionHeader(title: l10n.searchSectionProducts),
          const SizedBox(height: HatlySpacing.sm),
          Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: HatlySpacing.screenPadding),
            child: Column(
              children: [
                for (var i = 0; i < products.length; i++) ...[
                  if (i > 0) const SizedBox(height: HatlySpacing.ms),
                  ProductResultCard(
                    product: products[i],
                    // A marketplace product → its store selector; an unlinked listing → Product Details.
                    onTap: () => context.push(products[i].catalogProductId !=
                            null
                        ? '/catalog-products/${products[i].catalogProductId}'
                        : '/products/${products[i].id}'),
                  ),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// The backend search result carries no ETA / delivery fee / promotion, so those
/// stay at the same "not provided" placeholders the vendor listing mapping
/// uses — and [VendorCoverCard] hides them. Rating and review count are real
/// (`ratingAverage` / `ratingCount` from the search response).
extension SearchVendorResultAsVendor on SearchVendorResult {
  Vendor toVendor() => Vendor(
        id: id,
        name: name,
        nameAr: nameAr,
        category: '',
        logoUrl: logoUrl,
        ratingAverage: ratingAverage,
        ratingCount: ratingCount,
        etaMinMinutes: 0,
        etaMaxMinutes: 0,
        deliveryFeeMinor: 0,
        isOpen: isOpen,
        openingHours: openingHours,
      );
}

/// One product search result: soft image, name, vendor, price. A single quiet
/// badge only for a real flash sale or subtotal discount.
class ProductResultCard extends StatelessWidget {
  const ProductResultCard(
      {super.key, required this.product, required this.onTap});

  final SearchProductResult product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name =
        isArabic && product.nameAr != null ? product.nameAr! : product.name;
    final vendorName = isArabic && product.vendorNameAr != null
        ? product.vendorNameAr!
        : product.vendorName;
    final offer = product.activeOffer;
    final flashPrice = offer != null &&
            offer.isFlashSale &&
            offer.specialPriceMinor != null &&
            offer.specialPriceMinor! < product.priceMinor
        ? offer.specialPriceMinor
        : null;
    final shown = flashPrice ?? product.priceMinor;
    final unit = product.isWeighted ? '/kg' : '';
    final hasSubtotalDiscount = offer?.mechanism == 'SUBTOTAL_DISCOUNT';

    return Semantics(
      button: true,
      label: [
        name,
        vendorName,
        '${formatMinorUnits(shown, context)}$unit',
        if (flashPrice != null) l10n.flashSaleBadge,
        if (hasSubtotalDiscount) l10n.subtotalDiscountAvailable,
      ].join('، '),
      onTap: onTap,
      excludeSemantics: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(HatlyRadius.card),
          boxShadow: HatlyShadows.soft(p),
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: BorderRadius.circular(HatlyRadius.card),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(HatlySpacing.sm),
              child: Row(
                children: [
                  HatlySoftImage(
                    url: product.imageUrl,
                    width: 80,
                    height: 80,
                    placeholderIcon: Icons.fastfood_outlined,
                  ),
                  const SizedBox(width: HatlySpacing.ms),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: context.type.small.copyWith(
                                color: p.textPrimary,
                                fontWeight: FontWeight.w600)),
                        Text(vendorName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.type.caption),
                        const SizedBox(height: HatlySpacing.xs),
                        Wrap(
                          crossAxisAlignment: WrapCrossAlignment.center,
                          spacing: HatlySpacing.xs,
                          children: [
                            LtrText(
                              '${formatMinorUnits(shown, context)}$unit',
                              style: context.type.small.copyWith(
                                  color: flashPrice != null
                                      ? p.urgent
                                      : p.textPrimary,
                                  fontWeight: FontWeight.w800),
                            ),
                            if (flashPrice != null)
                              LtrText(
                                formatMinorUnits(product.priceMinor, context),
                                style: context.type.caption.copyWith(
                                    decoration: TextDecoration.lineThrough),
                              ),
                          ],
                        ),
                        if (flashPrice != null || hasSubtotalDiscount) ...[
                          const SizedBox(height: HatlySpacing.xs),
                          HatlyBadge(
                            kind: flashPrice != null
                                ? HatlyBadgeKind.flashSale
                                : HatlyBadgeKind.offer,
                            label: flashPrice != null
                                ? l10n.flashSaleBadge
                                : l10n.subtotalDiscountAvailable,
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
