import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/filter_action_button.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/hatly_soft_image.dart';
import '../../../shared_widgets/hatly_rating_inline.dart';
import '../../../shared_widgets/availability_badge.dart';
import '../../../shared_widgets/cart_summary_bar.dart';
import '../../../shared_widgets/sort_menu_button.dart';
import '../../products/data/product_providers.dart';
import '../../products/domain/product_category.dart';
import '../../products/domain/product_filters.dart';
import '../../products/presentation/widgets/product_filter_sheet.dart';
import '../../products/presentation/widgets/product_list_tile.dart';
import '../../products/presentation/widgets/product_list_tile_skeleton.dart';
import '../data/vendor_providers.dart';
import '../domain/vendor_branch_summary.dart';
import '../domain/opening_hours.dart';
import '../domain/vendor_details.dart';
import '../../cart/presentation/widgets/cart_icon_button.dart';
import '../../auth/presentation/auth_gate.dart';
import '../../home/presentation/widgets/home_promo_actions.dart'
    show handleQuickAdd;
import '../../favorites/data/favorites_providers.dart';
import 'widgets/custom_request_action.dart';

/// Real Vendor Details screen (Phase 2C) — was a placeholder in Phase
/// 2B. Composed of: vendor identity header, branch info section
/// (kept visually and structurally distinct from the vendor identity
/// — see vendor_details.dart), a category filter row scoped to this
/// vendor's own menu, and the filtered product list. No cart/checkout
/// entry point anywhere on this screen — out of scope for this phase.
class VendorDetailsScreen extends ConsumerStatefulWidget {
  const VendorDetailsScreen({super.key, required this.vendorId});

  final String vendorId;

  @override
  ConsumerState<VendorDetailsScreen> createState() =>
      _VendorDetailsScreenState();
}

class _VendorDetailsScreenState extends ConsumerState<VendorDetailsScreen> {
  String? _selectedCategoryId;
  String? _sortOption;
  String _searchQuery = '';
  // Filters V1. The committed/active filter state — the filter sheet
  // only ever replaces this wholesale, on Apply.
  ProductFilters _filters = ProductFilters.empty;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final detailsAsync = ref.watch(vendorDetailsProvider(widget.vendorId));

    return detailsAsync.when(
      // Polish pass: the loading state was missing its AppBar (no back
      // button — a real navigation regression on a screen reached via
      // `context.push`, since the AppBar only appeared once loading
      // finished into the error branch) and used a raw
      // `CircularProgressIndicator` instead of the shared `HatlyLoadingView`.
      loading: () => Scaffold(appBar: AppBar(), body: const HatlyLoadingView()),
      error: (error, stackTrace) => Scaffold(
        appBar: AppBar(),
        body: HatlyStateView(
          icon: Icons.error_outline,
          title: l10n.somethingWentWrong,
          retryLabel: l10n.retry,
          onRetry: () => ref.invalidate(vendorDetailsProvider(widget.vendorId)),
        ),
      ),
      data: (details) => Scaffold(
        bottomNavigationBar: const CartSummaryBar(),
        body: _VendorDetailsContent(
          details: details,
          selectedCategoryId: _selectedCategoryId,
          onCategorySelected: (id) => setState(() => _selectedCategoryId = id),
          sortOption: _sortOption,
          onSortChanged: (sort) => setState(() => _sortOption = sort),
          searchQuery: _searchQuery,
          onSearchChanged: (query) => setState(() => _searchQuery = query),
          filters: _filters,
          onFiltersChanged: (filters) => setState(() => _filters = filters),
        ),
      ),
    );
  }
}

class _VendorDetailsContent extends ConsumerWidget {
  const _VendorDetailsContent({
    required this.details,
    required this.selectedCategoryId,
    required this.onCategorySelected,
    required this.sortOption,
    required this.onSortChanged,
    required this.searchQuery,
    required this.onSearchChanged,
    required this.filters,
    required this.onFiltersChanged,
  });

  final VendorDetails details;
  final String? selectedCategoryId;
  final ValueChanged<String?> onCategorySelected;
  final String? sortOption;
  final ValueChanged<String?> onSortChanged;
  final String searchQuery;
  final ValueChanged<String> onSearchChanged;
  final ProductFilters filters;
  final ValueChanged<ProductFilters> onFiltersChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final vendorName = isArabic && details.vendor.nameAr != null
        ? details.vendor.nameAr!
        : details.vendor.name;

    final categoriesAsync =
        ref.watch(productCategoriesProvider(details.branch.id));
    final productListParams = (
      vendorBranchId: details.branch.id,
      categoryId: selectedCategoryId,
      sort: sortOption,
      search: searchQuery.isEmpty ? null : searchQuery,
      page: null,
      limit: null,
      availableOnly: filters.availableOnly,
      hasOffers: filters.hasOffers,
      minPriceMinor: filters.minPriceMinor,
      maxPriceMinor: filters.maxPriceMinor,
    );
    final productsAsync = ref.watch(productListProvider(productListParams));
    // The menu loads 20 at a time: the first page above, then the next pages as the customer nears the end of the list.
    final more = ref.watch(moreProductsProvider(productListParams));
    final firstPage = productsAsync.valueOrNull;
    final canLoadMore =
        firstPage != null && firstPage.length >= kMenuPageSize && !more.done;

    // Filters V1: real bounds derived from the vendor's own currently-loaded (unfiltered-by-price)
    // product list — never a hardcoded/arbitrary business limit, never a second network call.
    final loadedPrices =
        productsAsync.valueOrNull?.map((p) => p.priceMinor).toList() ??
            const <int>[];
    final minAvailablePriceMinor = loadedPrices.isEmpty
        ? null
        : loadedPrices.reduce((a, b) => a < b ? a : b);
    final maxAvailablePriceMinor = loadedPrices.isEmpty
        ? null
        : loadedPrices.reduce((a, b) => a > b ? a : b);

    return NotificationListener<ScrollNotification>(
      onNotification: (n) {
        if (canLoadMore && !more.loading && n.metrics.extentAfter < 600) {
          ref.read(moreProductsProvider(productListParams).notifier).loadMore();
        }
        return false;
      },
      child: CustomScrollView(
        slivers: [
          SliverAppBar(
            title: Text(vendorName),
            pinned: true,
            actions: [
              _FavoriteHeartButton(vendorId: details.vendor.id),
              const CartIconButton()
            ],
          ),
          SliverToBoxAdapter(
              child: _VendorHeader(details: details, vendorName: vendorName)),
          SliverToBoxAdapter(child: _BranchInfoSection(branch: details.branch)),
          if (!details.branch.isOpen)
            const SliverToBoxAdapter(child: _ClosedBanner()),
          // Visual UX (reference comparison): the menu search comes straight after the vendor/branch
          // info, then the menu sections, directly above the products they filter.
          const SliverToBoxAdapter(child: SizedBox(height: HatlySpacing.sm)),
          SliverToBoxAdapter(
            child: _ProductSearchAndSortBar(
              searchQuery: searchQuery,
              onSearchChanged: onSearchChanged,
              sortOption: sortOption,
              onSortChanged: onSortChanged,
              filters: filters,
              onFiltersChanged: onFiltersChanged,
              minAvailablePriceMinor: minAvailablePriceMinor,
              maxAvailablePriceMinor: maxAvailablePriceMinor,
            ),
          ),
          const SliverToBoxAdapter(child: SizedBox(height: HatlySpacing.sm)),
          SliverToBoxAdapter(
            child: categoriesAsync.when(
              loading: () => const SizedBox(height: 44),
              // Non-critical: the product list below still works
              // unfiltered even if this vendor's own category chips fail
              // to load — no need to block the whole screen on it.
              error: (error, stackTrace) => const SizedBox.shrink(),
              data: (categories) => _CategoryChipsRow(
                categories: categories,
                selectedCategoryId: selectedCategoryId,
                onCategorySelected: onCategorySelected,
              ),
            ),
          ),
          const SliverToBoxAdapter(child: SizedBox(height: 8)),
          productsAsync.when(
            loading: () => const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  children: [
                    ProductListTileSkeleton(),
                    ProductListTileSkeleton(),
                    ProductListTileSkeleton(),
                  ],
                ),
              ),
            ),
            error: (error, stackTrace) => SliverToBoxAdapter(
              child: SizedBox(
                height: 200,
                child: HatlyStateView(
                  icon: Icons.wifi_off_rounded,
                  title: l10n.somethingWentWrong,
                  retryLabel: l10n.retry,
                  onRetry: () =>
                      ref.invalidate(productListProvider(productListParams)),
                ),
              ),
            ),
            data: (firstProducts) {
              final products = [...firstProducts, ...more.items];
              if (products.isEmpty) {
                return SliverToBoxAdapter(
                  child: SizedBox(
                    height: 180,
                    child: HatlyStateView(
                        icon: Icons.no_food_outlined,
                        title: l10n.noProductsFound),
                  ),
                );
              }
              return SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final product = products[index];
                      return ProductListTile(
                        product: product,
                        onTap: () => context.push('/products/${product.id}'),
                        // Same one-tap add as Home (one unit via the cart controller; hands off to the product
                        // page when the backend needs an option/weight choice or the cart is another branch's).
                        onQuickAdd: details.branch.isOpen
                            ? () => handleQuickAdd(context, ref, product.id)
                            : null,
                        orderingDisabled: !details.branch.isOpen,
                      );
                    },
                    childCount: products.length,
                  ),
                ),
              );
            },
          ),
          if (more.loading)
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: 16),
                child: ProductListTileSkeleton(),
              ),
            )
          else if (more.failed && canLoadMore)
            SliverToBoxAdapter(
              child: Center(
                child: TextButton(
                  key: const Key('menu-load-more-retry'),
                  onPressed: () => ref
                      .read(moreProductsProvider(productListParams).notifier)
                      .loadMore(),
                  child: Text(l10n.retry),
                ),
              ),
            ),
          // Only where the server allows it (the branch's sector setting; the cart endpoint enforces the same rule).
          if (details.branch.allowsCustomRequests && details.branch.isOpen)
            SliverToBoxAdapter(
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Center(
                    child:
                        CustomRequestAction(vendorBranchId: details.branch.id)),
              ),
            ),
          const SliverToBoxAdapter(child: SizedBox(height: 24)),
        ],
      ),
    );
  }
}

class _VendorHeader extends StatelessWidget {
  const _VendorHeader({required this.details, required this.vendorName});

  final VendorDetails details;
  final String vendorName;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;

    const logoSize = 72.0;
    // Image-first header: a wide cover, the logo overlapping its lower edge, then the name, the rating and the offer badge.
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          HatlySpacing.md, HatlySpacing.sm, HatlySpacing.md, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              HatlySoftImage(
                url: details.vendor.coverImageUrl ?? details.vendor.logoUrl,
                width: double.infinity,
                height: 140,
                radius: HatlyRadius.card,
                placeholderIcon: Icons.storefront_outlined,
                placeholderIconSize: 44,
              ),
              PositionedDirectional(
                bottom: -(logoSize / 2),
                start: HatlySpacing.md,
                child: Container(
                  padding: const EdgeInsets.all(3),
                  decoration:
                      BoxDecoration(color: p.surface, shape: BoxShape.circle),
                  child: HatlySoftImage(
                    url: details.vendor.logoUrl,
                    width: logoSize,
                    height: logoSize,
                    circular: true,
                    placeholderIcon: Icons.store_outlined,
                    placeholderIconSize: 30,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: logoSize / 2 + HatlySpacing.sm),
          Wrap(
            spacing: HatlySpacing.sm,
            runSpacing: HatlySpacing.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(vendorName, style: Theme.of(context).textTheme.titleLarge),
              if (details.hasPromotion)
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: HatlySpacing.sm, vertical: 3),
                  decoration: BoxDecoration(
                    color: HatlyColors.primaryOrange,
                    borderRadius: BorderRadius.circular(HatlyRadius.chip),
                  ),
                  child: Text(
                    l10n.promotionBadge,
                    style: Theme.of(context)
                        .textTheme
                        .labelLarge
                        ?.copyWith(color: p.accentOn),
                  ),
                ),
            ],
          ),
          if (details.ratingCount > 0) ...[
            const SizedBox(height: HatlySpacing.xs),
            HatlyRatingInline(
                key: const Key('vendor-details-rating'),
                average: details.ratingAverage,
                count: details.ratingCount),
          ],
        ],
      ),
    );
  }
}

/// Branch info kept in its own visually distinct section — reinforces
/// that this is the branch's data, not the vendor's, in the UI itself
/// and not just in code structure (see vendor_details.dart).
class _BranchInfoSection extends StatelessWidget {
  const _BranchInfoSection({required this.branch});

  final VendorBranchSummary branch;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final hoursLabel = todayHoursLabel(branch.openingHours, l10n);

    return Container(
      margin: const EdgeInsets.fromLTRB(
          HatlySpacing.md, HatlySpacing.md, HatlySpacing.md, 0),
      padding: const EdgeInsets.all(HatlySpacing.ms),
      // Polish pass: was `HatlyColors.background`/`HatlyColors.textMuted`
      // (fixed light-mode constants) — this container stayed a bright
      // off-white box on a dark screen in Dark Mode. `p.surfaceSoft`/
      // `p.textMuted` are the theme-aware equivalents.
      decoration: BoxDecoration(
          color: p.surface,
          border: Border.all(color: p.border),
          borderRadius: BorderRadius.circular(HatlyRadius.card)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.location_on_rounded, size: 18, color: p.accent),
              const SizedBox(width: HatlySpacing.sm),
              Expanded(
                  child: Text(branch.address,
                      style: Theme.of(context).textTheme.bodyMedium)),
            ],
          ),
          const SizedBox(height: HatlySpacing.sm),
          // Wrap, not Row: at 320px with large text the hours drop to the next line instead of overflowing.
          Wrap(
            spacing: HatlySpacing.sm,
            runSpacing: HatlySpacing.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              AvailabilityBadge(
                isOpen: branch.isOpen,
                openLabel: l10n.vendorOpenNow,
                closedLabel: l10n.vendorClosed,
              ),
              if (hoursLabel != null)
                Text(
                  '· ${l10n.vendorHoursToday(hoursLabel)}',
                  key: const Key('vendor-details-hours'),
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Shown under the branch info when the store is closed (switched off, temporarily closed or outside its working hours):
/// the menu stays browsable, ordering is refused (owner request 2026-11-23).
class _ClosedBanner extends StatelessWidget {
  const _ClosedBanner();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return Container(
      key: const Key('vendor-closed-banner'),
      margin: const EdgeInsets.fromLTRB(
          HatlySpacing.md, HatlySpacing.sm, HatlySpacing.md, 0),
      padding: const EdgeInsets.all(HatlySpacing.ms),
      decoration: BoxDecoration(
          color: p.surface,
          border: Border.all(color: p.border),
          borderRadius: BorderRadius.circular(HatlyRadius.card)),
      child: Row(children: [
        Icon(Icons.lock_clock_outlined, color: p.textMuted),
        const SizedBox(width: HatlySpacing.sm),
        Expanded(child: Text(l10n.vendorClosedBanner)),
      ]),
    );
  }
}

/// CONFIRMED (Discovery & Ranking): a search field + sort control
/// scoped to THIS vendor's own menu — never a marketplace-wide search
/// (that's `vendor_list_screen.dart`'s own, separate control). Both
/// values flow straight into `productListProvider`'s real backend
/// query; neither is ever used to filter/sort/re-rank the already-
/// fetched list client-side.
class _ProductSearchAndSortBar extends StatelessWidget {
  const _ProductSearchAndSortBar({
    required this.searchQuery,
    required this.onSearchChanged,
    required this.sortOption,
    required this.onSortChanged,
    required this.filters,
    required this.onFiltersChanged,
    required this.minAvailablePriceMinor,
    required this.maxAvailablePriceMinor,
  });

  final String searchQuery;
  final ValueChanged<String> onSearchChanged;
  final String? sortOption;
  final ValueChanged<String?> onSortChanged;
  final ProductFilters filters;
  final ValueChanged<ProductFilters> onFiltersChanged;
  final int? minAvailablePriceMinor;
  final int? maxAvailablePriceMinor;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    // Dark Mode fix (audit F-D3): fixed `Colors.grey.shade100` search fill —
    // identical to the old constant in Light Mode.
    final p = context.palette;

    final searchField = TextField(
      onChanged: onSearchChanged,
      decoration: InputDecoration(
        hintText: l10n.searchHint,
        prefixIcon: const Icon(Icons.search, size: 20),
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(vertical: 10),
        filled: true,
        fillColor: p.surfaceSoft,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(20),
          borderSide: BorderSide.none,
        ),
      ),
    );
    final filterButton = FilterActionButton(
      key: const Key('product-filter-action'),
      label: l10n.filterAction,
      activeCount: filters.activeCount,
      onTap: () async {
        final result = await showModalBottomSheet<ProductFilters>(
          context: context,
          isScrollControlled: true,
          builder: (_) => ProductFilterSheet(
            initialFilters: filters,
            minAvailablePriceMinor: minAvailablePriceMinor,
            maxAvailablePriceMinor: maxAvailablePriceMinor,
          ),
        );
        if (result != null) onFiltersChanged(result);
      },
    );
    final sortButton = SortMenuButton(
      value: sortOption,
      label: l10n.sortNewest,
      onChanged: onSortChanged,
      options: [
        ('newest', l10n.sortNewest),
        ('highestRated', l10n.sortHighestRated),
        ('bestSelling', l10n.sortBestSelling),
        ('price_asc', l10n.sortPriceLowToHigh),
        ('price_desc', l10n.sortPriceHighToLow),
        ('offers', l10n.sortOffers),
      ],
    );

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: LayoutBuilder(builder: (context, constraints) {
        // A narrow screen or large text (320px at 2×) has no room for the field and both labelled
        // buttons on one line: the buttons then wrap under the field instead of overflowing it.
        final scale = MediaQuery.textScalerOf(context).scale(1);
        if (constraints.maxWidth / scale < 300) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              searchField,
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [filterButton, sortButton],
              ),
            ],
          );
        }
        return Row(
          children: [
            Expanded(child: searchField),
            const SizedBox(width: 8),
            filterButton,
            const SizedBox(width: 8),
            sortButton,
          ],
        );
      }),
    );
  }
}

class _CategoryChipsRow extends StatelessWidget {
  const _CategoryChipsRow({
    required this.categories,
    required this.selectedCategoryId,
    required this.onCategorySelected,
  });

  final List<ProductCategoryInfo> categories;
  final String? selectedCategoryId;
  final ValueChanged<String?> onCategorySelected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    if (categories.isEmpty) return const SizedBox.shrink();

    return SizedBox(
      height: 40,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          _CategoryChip(
            label: l10n.allProducts,
            selected: selectedCategoryId == null,
            onTap: () => onCategorySelected(null),
          ),
          const SizedBox(width: 8),
          for (final category in categories) ...[
            _CategoryChip(
              label: isArabic && category.nameAr != null
                  ? category.nameAr!
                  : category.name,
              selected: selectedCategoryId == category.id,
              onTap: () => onCategorySelected(category.id),
            ),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }
}

class _CategoryChip extends StatelessWidget {
  const _CategoryChip(
      {required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Dark Mode fix (audit F-D3): fixed `Colors.grey.shade100`/`textDark` —
    // identical to the old constants in Light Mode.
    // Polish pass: the selected state used to stay hardcoded white-on-orange
    // (2.6:1 contrast) — now `p.accentOn` (7:1), matching this chip's own two
    // "deliberately identical" twins (`_SubcategoryChip`, `_RatingChip`),
    // which were fixed the same way.
    final p = context.palette;
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => onTap(),
      selectedColor: HatlyColors.primaryOrange,
      labelStyle: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w600,
        color: selected ? p.accentOn : p.textPrimary,
      ),
      backgroundColor: p.surfaceSoft,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20), side: BorderSide.none),
    );
  }
}

/// Favorites Chunk 3. Same source-of-truth/no-per-card-request/
/// narrow-rebuild reasoning as VendorCard's own `_FavoriteHeartButton`
/// — kept as a separate private copy in this file, per this chunk's
/// own file-scope restriction (no new shared-widget file introduced
/// for this).
class _FavoriteHeartButton extends ConsumerWidget {
  const _FavoriteHeartButton({required this.vendorId});

  final String vendorId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final controller = ref.watch(favoritesControllerProvider.notifier);
    final isLoading = ref.watch(favoritesControllerProvider).isLoading;
    final isFavorited = controller.isFavorited(vendorId);

    return IconButton(
      icon: Icon(
        isFavorited ? Icons.favorite : Icons.favorite_border,
        color: isFavorited ? HatlyColors.primaryOrange : null,
      ),
      tooltip:
          isFavorited ? l10n.favoritesRemoveAction : l10n.favoritesAddAction,
      onPressed: isLoading
          ? null
          : () async {
              // Favourites belong to an account: a guest is sent to sign-in first (nothing is requested).
              if (!requireSignIn(context, ref)) return;
              final error = isFavorited
                  ? await controller.remove(vendorId)
                  : await controller.add(vendorId);
              if (error != null && context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(l10n.somethingWentWrong)),
                );
              }
            },
    );
  }
}
