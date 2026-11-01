import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_section_header.dart';
import '../../../../shared_widgets/hatly_surface.dart';
import '../../../../shared_widgets/skeleton_box.dart';
import '../../../sectors/domain/sector.dart';
import '../../../shell/presentation/shell_tab_provider.dart';
import '../../data/home_content_config.dart';
import '../../data/home_providers.dart';
import 'category_card.dart';

/// Shop by Category — a calm 3-column grid, the Marketplace entry point of
/// Home. Shows the first [kHomeMaxCategories] of [homeCategoriesProvider]
/// (data-driven order, re-orderable through `home_content_config.dart`); when
/// there are more, the header gets "عرض الكل ←", which opens Explore.
class HomeCategorySection extends ConsumerWidget {
  const HomeCategorySection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final categoriesAsync = ref.watch(homeCategoriesProvider);

    return categoriesAsync.when(
      loading: () => const CategoryGridSkeleton(),
      // A failed category call must not blank Home — and must not look like "no stores" either: say it failed, with a retry. (When the whole
      // Home snapshot failed, Home shows its own full retry state instead and this section is not built.)
      error: (error, stackTrace) => HomeCategoriesError(onRetry: () {
        // The product rows below failed for the same reason (they are built from the same sectors call): retry both.
        ref.invalidate(homeCategoriesProvider);
        ref.invalidate(homeSnapshotProvider);
      }),
      data: (categories) {
        // Loaded fine but nothing to show (no active category yet, e.g. a market that has not opened): say so. A bare blank
        // page next to the Hatly Service card reads as a broken app. (A FAILED load shows its own error + retry here; the product rows below do not repeat it.)
        if (categories.isEmpty) return const HomeNoStoresNotice();
        final hasMore = categories.length > kHomeMaxCategories;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            HatlySectionHeader(
              title: l10n.homeSectionCategories,
              seeAllLabel: hasMore ? l10n.seeAll : null,
              onSeeAll: hasMore
                  ? () => ref.read(shellTabIndexProvider.notifier).state =
                      ShellTab.search
                  : null,
            ),
            const SizedBox(height: HatlySpacing.sm),
            CategoryGrid(
                categories: categories.take(kHomeMaxCategories).toList()),
          ],
        );
      },
    );
  }
}

/// Category navigation: opens the VENDOR-FIRST discovery listing of the sector (`GET
/// /vendors?sectorId=`, via `VendorListScreen`), shared by Home, Explore's grid, its featured row and
/// search matches. This is a deliberate, universal product decision — every marketplace category
/// (Restaurants, Groceries, Pharmacies, ...) enters through vendor/branch selection first; there is
/// no category that opens a product listing directly. Previously routed to a now-removed
/// product-first `/category-products` screen — a regression relative to this same rule, fixed here.
String categoryListingRoute(MarketplaceSector sector,
    {required bool isArabic}) {
  final name = categoryDisplayName(sector, isArabic: isArabic);
  return '/vendors?sectorId=${sector.id}&sectorName=${Uri.encodeComponent(name)}';
}

String categoryDisplayName(MarketplaceSector sector,
        {required bool isArabic}) =>
    isArabic && sector.nameAr != null ? sector.nameAr! : sector.name;

/// The grid itself (separated so it can be tested with plain data): rows of
/// [columns] equal cells, generous spacing, no cards or dividers. Rows size to
/// their content, so larger system text never overflows.
class CategoryGrid extends StatelessWidget {
  const CategoryGrid({super.key, required this.categories});

  final List<MarketplaceSector> categories;

  static const int columns = 3;
  static const double columnGap = HatlySpacing.md;
  static const double rowGap = HatlySpacing.md;

  @override
  Widget build(BuildContext context) {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    Widget cell(MarketplaceSector sector) {
      return CategoryCard(
        label: categoryDisplayName(sector, isArabic: isArabic),
        slug: sector.slug,
        imageUrl: sector.imageUrl,
        onTap: () =>
            context.push(categoryListingRoute(sector, isArabic: isArabic)),
      );
    }

    final rows = <Widget>[];
    for (var start = 0; start < categories.length; start += columns) {
      if (start > 0) rows.add(const SizedBox(height: rowGap));
      rows.add(Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < columns; i++) ...[
            if (i > 0) const SizedBox(width: columnGap),
            Expanded(
              child: start + i < categories.length
                  ? cell(categories[start + i])
                  : const SizedBox.shrink(),
            ),
          ],
        ],
      ));
    }

    return Padding(
      padding:
          const EdgeInsets.symmetric(horizontal: HatlySpacing.screenPadding),
      child: Column(children: rows),
    );
  }
}

class CategoryGridSkeleton extends StatelessWidget {
  const CategoryGridSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding:
          const EdgeInsets.symmetric(horizontal: HatlySpacing.screenPadding),
      child: Row(
        children: [
          for (var i = 0; i < CategoryGrid.columns; i++) ...[
            if (i > 0) const SizedBox(width: CategoryGrid.columnGap),
            const Expanded(
              child: AspectRatio(
                aspectRatio: 1,
                child: SkeletonBox(
                    width: double.infinity,
                    height: double.infinity,
                    borderRadius: HatlyRadius.imageContainer),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Shown on Home when the marketplace answered successfully but has no active category/store yet. Never invents content.
class HomeNoStoresNotice extends StatelessWidget {
  const HomeNoStoresNotice({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return Padding(
      padding:
          const EdgeInsets.symmetric(horizontal: HatlySpacing.screenPadding),
      child: HatlySurface(
        key: const Key('home-no-stores'),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.storefront_outlined, color: p.textMuted),
            const SizedBox(width: HatlySpacing.ms),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.homeNoStoresTitle, style: context.type.title),
                  const SizedBox(height: HatlySpacing.xs),
                  Text(l10n.homeNoStoresBody,
                      style: context.type.small.copyWith(color: p.textMuted)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Categories could not be loaded (a network or server problem) — distinct from [HomeNoStoresNotice], which means the server
/// answered and there is genuinely nothing to show yet.
class HomeCategoriesError extends StatelessWidget {
  const HomeCategoriesError({super.key, required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return Padding(
      padding:
          const EdgeInsets.symmetric(horizontal: HatlySpacing.screenPadding),
      child: HatlySurface(
        key: const Key('home-categories-error'),
        child: Row(
          children: [
            Icon(Icons.wifi_off_rounded, color: p.textMuted),
            const SizedBox(width: HatlySpacing.ms),
            Expanded(
                child: Text(l10n.somethingWentWrong, style: context.type.body)),
            TextButton(
              key: const Key('home-categories-retry'),
              onPressed: onRetry,
              child: Text(l10n.retry),
            ),
          ],
        ),
      ),
    );
  }
}
