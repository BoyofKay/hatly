import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_search_field.dart';
import '../../../shared_widgets/skeleton_box.dart';
import '../../home/data/home_address_provider.dart';
import '../../search/presentation/widgets/explore_message.dart';
import '../data/catalog_providers.dart';
import '../domain/catalog_product.dart';
import 'widgets/marketplace_product_card.dart';

/// Where a marketplace item leads: a grouped catalog product opens its store selector, an unlinked listing
/// opens the existing Product Details with its own (listing) id.
String catalogItemRoute(CatalogProductSummary item) => item.isLinked
    ? '/catalog-products/${item.catalogProductId}'
    : '/products/${item.listingId}';

/// Product-first category listing (`GET /products?sectorId=`) — what a category tap on Home/Explore opens.
/// Search, the backend's sort options, pagination (20 per page, loads more near the bottom),
/// service-area filtering (through the saved address) and pull-to-refresh all use the existing patterns.
class CategoryProductsScreen extends ConsumerStatefulWidget {
  const CategoryProductsScreen(
      {super.key, required this.sectorId, this.sectorName});

  final String sectorId;
  final String? sectorName;

  @override
  ConsumerState<CategoryProductsScreen> createState() =>
      _CategoryProductsScreenState();
}

class _CategoryProductsScreenState
    extends ConsumerState<CategoryProductsScreen> {
  final _searchController = TextEditingController();
  Timer? _debounce;
  String? _sort;
  String _search = '';

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    // Same 400 ms debounce as Explore: no new listing (and request) per keystroke.
    _debounce = Timer(const Duration(milliseconds: 400), () {
      if (mounted) setState(() => _search = value.trim());
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final address = ref.watch(homeActiveAddressProvider).valueOrNull;
    final key = (
      sectorId: widget.sectorId,
      sort: _sort,
      search: _search.isEmpty ? null : _search,
      // Real saved-address coordinates only — never fabricated.
      latitude: address?.latitude,
      longitude: address?.longitude,
    );
    final productsAsync = ref.watch(sectorProductsControllerProvider(key));
    final controller = ref.read(sectorProductsControllerProvider(key).notifier);

    return Scaffold(
      appBar: AppBar(title: Text(widget.sectorName ?? l10n.navExplore)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(HatlySpacing.screenPadding,
                HatlySpacing.sm, HatlySpacing.screenPadding, HatlySpacing.sm),
            child: Row(
              children: [
                Expanded(
                  child: HatlySearchField(
                    controller: _searchController,
                    hintText: l10n.categoryProductsSearchHint,
                    clearTooltip: l10n.exploreSearchClear,
                    onChanged: _onSearchChanged,
                  ),
                ),
                const SizedBox(width: HatlySpacing.sm),
                _SortButton(
                  value: _sort,
                  onChanged: (sort) => setState(() => _sort = sort),
                ),
              ],
            ),
          ),
          Expanded(
            child: productsAsync.when(
              loading: () => const _ListingSkeleton(),
              error: (error, stackTrace) => ExploreMessage(
                icon: Icons.wifi_off_rounded,
                title: l10n.somethingWentWrong,
                retryLabel: l10n.retry,
                onRetry: controller.refresh,
              ),
              data: (items) {
                if (items.isEmpty) {
                  return RefreshIndicator(
                    onRefresh: controller.refresh,
                    child: ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: [
                        SizedBox(
                          height: 320,
                          child: ExploreMessage(
                            icon: Icons.inventory_2_outlined,
                            title: l10n.noProductsFound,
                          ),
                        ),
                      ],
                    ),
                  );
                }
                return RefreshIndicator(
                  onRefresh: controller.refresh,
                  child: NotificationListener<ScrollNotification>(
                    onNotification: (n) {
                      if (n.metrics.pixels >= n.metrics.maxScrollExtent - 300) {
                        controller.loadMore();
                      }
                      return false;
                    },
                    child: _ProductGrid(
                      items: items,
                      hasMore: controller.hasMore,
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Two-column grid built from IntrinsicHeight rows (cards size to their content, so larger system text
/// never overflows) inside a lazy list — the next page is requested near the bottom.
class _ProductGrid extends StatelessWidget {
  const _ProductGrid({required this.items, required this.hasMore});

  final List<CatalogProductSummary> items;
  final bool hasMore;

  static const int columns = 2;
  static const double gap = HatlySpacing.ms;

  @override
  Widget build(BuildContext context) {
    final rowCount = (items.length / columns).ceil();

    return LayoutBuilder(
      builder: (context, constraints) {
        final cardWidth = (constraints.maxWidth -
                HatlySpacing.screenPadding * 2 -
                gap * (columns - 1)) /
            columns;
        return ListView.builder(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(HatlySpacing.screenPadding,
              HatlySpacing.xs, HatlySpacing.screenPadding, HatlySpacing.lg),
          itemCount: rowCount + (hasMore ? 1 : 0),
          itemBuilder: (context, row) {
            if (row == rowCount) {
              return const Padding(
                padding: EdgeInsets.all(HatlySpacing.md),
                child: Center(
                    child: SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(strokeWidth: 2.5))),
              );
            }
            return Padding(
              padding: const EdgeInsets.only(bottom: gap),
              child: IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var c = 0; c < columns; c++) ...[
                      if (c > 0) const SizedBox(width: gap),
                      row * columns + c < items.length
                          ? MarketplaceProductCard(
                              item: items[row * columns + c],
                              width: cardWidth,
                              onTap: () => context.push(
                                  catalogItemRoute(items[row * columns + c])),
                              // never silently picks a vendor: grouped → the store selector, unlinked → its own
                              // configuration screen
                              onAdd: () => context.push(
                                  catalogItemRoute(items[row * columns + c])),
                            )
                          : SizedBox(width: cardWidth),
                    ],
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
}

/// The backend's five sort options in one calm popup; "newest" is the API default (no `sort` sent).
class _SortButton extends StatelessWidget {
  const _SortButton({required this.value, required this.onChanged});

  final String? value;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final options = <(String?, String)>[
      (null, l10n.sortNewest),
      ('highestRated', l10n.sortHighestRated),
      ('bestSelling', l10n.sortBestSelling),
      ('price_asc', l10n.sortPriceLowToHigh),
      ('price_desc', l10n.sortPriceHighToLow),
    ];

    return PopupMenuButton<String?>(
      tooltip: l10n.sortLabel,
      initialValue: value,
      onSelected: onChanged,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(HatlyRadius.card)),
      itemBuilder: (context) => [
        for (final option in options)
          CheckedPopupMenuItem<String?>(
            value: option.$1,
            checked: option.$1 == value,
            child: Text(option.$2),
          ),
      ],
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: p.surfaceSoft,
          borderRadius: BorderRadius.circular(HatlyRadius.searchBar),
        ),
        child: Icon(Icons.swap_vert_rounded, color: p.textPrimary, size: 24),
      ),
    );
  }
}

class _ListingSkeleton extends StatelessWidget {
  const _ListingSkeleton();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(HatlySpacing.screenPadding),
      child: Column(
        children: [
          for (var r = 0; r < 2; r++) ...[
            const Row(
              children: [
                Expanded(
                    child: SkeletonBox(
                        width: double.infinity,
                        height: 220,
                        borderRadius: HatlyRadius.card)),
                SizedBox(width: HatlySpacing.ms),
                Expanded(
                    child: SkeletonBox(
                        width: double.infinity,
                        height: 220,
                        borderRadius: HatlyRadius.card)),
              ],
            ),
            const SizedBox(height: HatlySpacing.ms),
          ],
        ],
      ),
    );
  }
}
