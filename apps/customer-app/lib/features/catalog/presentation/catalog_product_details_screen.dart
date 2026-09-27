import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../shared_widgets/expandable_text.dart';
import '../../../shared_widgets/hatly_section_header.dart';
import '../../../shared_widgets/hatly_soft_image.dart';
import '../../../shared_widgets/ltr_text.dart';
import '../../../shared_widgets/skeleton_box.dart';
import '../../cart/presentation/widgets/cart_icon_button.dart';
import '../../home/data/home_address_provider.dart';
import '../../search/presentation/widgets/explore_message.dart';
import '../data/catalog_providers.dart';
import '../domain/catalog_product.dart';
import 'widgets/vendor_listing_card.dart';

/// Catalog Product Details (`GET /catalog-products/:id`): image first, the shared product identity, a compact
/// description, and "متوفر من X متاجر" with one card per real vendor listing (backend order, cheapest
/// first). Nothing is pre-selected and no store is highlighted — the customer explicitly chooses, which
/// opens Product Details for THAT listing (`/products/:listingId`), the id the cart uses.
class CatalogProductDetailsScreen extends ConsumerWidget {
  const CatalogProductDetailsScreen(
      {super.key, required this.catalogProductId});

  final String catalogProductId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final address = ref.watch(homeActiveAddressProvider).valueOrNull;
    final key = (
      catalogProductId: catalogProductId,
      latitude: address?.latitude,
      longitude: address?.longitude,
    );
    final detailsAsync = ref.watch(catalogProductDetailsProvider(key));

    return Scaffold(
      appBar: AppBar(actions: const [CartIconButton()]),
      body: detailsAsync.when(
        loading: () => const _DetailsSkeleton(),
        error: (error, stackTrace) => ExploreMessage(
          icon: Icons.wifi_off_rounded,
          title: l10n.somethingWentWrong,
          retryLabel: l10n.retry,
          onRetry: () => ref.invalidate(catalogProductDetailsProvider(key)),
        ),
        data: (details) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(catalogProductDetailsProvider(key));
            await ref
                .read(catalogProductDetailsProvider(key).future)
                .catchError((_) => details);
          },
          child: _Content(details: details),
        ),
      ),
    );
  }
}

class _Content extends StatelessWidget {
  const _Content({required this.details});

  final CatalogProductDetails details;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name =
        isArabic && details.nameAr != null ? details.nameAr! : details.name;
    final description = isArabic && details.descriptionAr != null
        ? details.descriptionAr
        : details.description;
    final listings = details.listings;
    final multiple = listings.length > 1;
    final fromPrice = listings.isEmpty
        ? null
        : listings.map((l) => l.priceMinor).reduce((a, b) => a < b ? a : b);
    final unit = details.isWeighted ? ' /kg' : '';

    return SafeArea(
      top: false,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(
            top: HatlySpacing.sm, bottom: HatlySpacing.xl),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: HatlySpacing.screenPadding),
            child: AspectRatio(
              aspectRatio: 1.85,
              child: HatlySoftImage(
                url: details.imageUrl,
                width: double.infinity,
                height: double.infinity,
                placeholderIcon: Icons.shopping_basket_outlined,
                placeholderIconSize: 56,
                semanticLabel: name,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(HatlySpacing.screenPadding,
                HatlySpacing.lg, HatlySpacing.screenPadding, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (details.brand != null)
                  Text(details.brand!, style: context.type.small),
                Semantics(
                  header: true,
                  child: Text(name,
                      style: context.type.h1.copyWith(
                          color: p.textPrimary, fontWeight: FontWeight.w800)),
                ),
                if (fromPrice != null) ...[
                  const SizedBox(height: HatlySpacing.sm),
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: HatlySpacing.sm,
                    children: [
                      LtrText(
                        multiple
                            ? l10n.catalogStartsFrom(
                                '${formatMinorUnits(fromPrice, context)}$unit')
                            : '${formatMinorUnits(fromPrice, context)}$unit',
                        style: context.type.h2.copyWith(
                            color: p.textPrimary, fontWeight: FontWeight.w800),
                      ),
                      Text(l10n.catalogStoreCount(listings.length),
                          style: context.type.small),
                    ],
                  ),
                ],
                if (description != null && description.trim().isNotEmpty) ...[
                  const SizedBox(height: HatlySpacing.md),
                  ExpandableText(description,
                      moreLabel: l10n.descriptionReadMore,
                      lessLabel: l10n.descriptionReadLess),
                ],
              ],
            ),
          ),
          const SizedBox(height: HatlySpacing.md),
          if (listings.isEmpty)
            SizedBox(
              height: 200,
              child: ExploreMessage(
                  icon: Icons.storefront_outlined,
                  title: l10n.productUnavailable),
            )
          else ...[
            HatlySectionHeader(
                title: l10n.catalogAvailableFromStores(listings.length)),
            const SizedBox(height: HatlySpacing.sm),
            Padding(
              padding: const EdgeInsets.symmetric(
                  horizontal: HatlySpacing.screenPadding),
              child: Column(
                children: [
                  for (var i = 0; i < listings.length; i++) ...[
                    if (i > 0) const SizedBox(height: HatlySpacing.ms),
                    VendorListingCard(
                      listing: listings[i],
                      // the SELECTED listing's id is the identity everything after this uses
                      onSelect: () => context.push(
                          '/products/${listings[i].listingId}?from=catalog'),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _DetailsSkeleton extends StatelessWidget {
  const _DetailsSkeleton();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.all(HatlySpacing.screenPadding),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SkeletonBox(
              width: double.infinity,
              height: 240,
              borderRadius: HatlyRadius.card),
          SizedBox(height: HatlySpacing.lg),
          SkeletonBox(width: 220, height: 28),
          SizedBox(height: HatlySpacing.md),
          SkeletonBox(
              width: double.infinity,
              height: 96,
              borderRadius: HatlyRadius.card),
        ],
      ),
    );
  }
}
