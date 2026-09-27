import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_section_header.dart';
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
      // A failed category call must not blank Home; the snapshot owns the
      // retry state.
      error: (error, stackTrace) => const SizedBox.shrink(),
      data: (categories) {
        if (categories.isEmpty) return const SizedBox.shrink();
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

/// Category navigation: opens the PRODUCT-FIRST listing of the sector (`GET /products?sectorId=`), shared
/// by Home, Explore's grid, its featured row and search matches. (Vendor browsing is unchanged and still
/// reachable through `/vendors/:id`.)
String categoryListingRoute(MarketplaceSector sector,
    {required bool isArabic}) {
  final name = categoryDisplayName(sector, isArabic: isArabic);
  return '/category-products?sectorId=${sector.id}&sectorName=${Uri.encodeComponent(name)}';
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
  static const double rowGap = HatlySpacing.lg;

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
