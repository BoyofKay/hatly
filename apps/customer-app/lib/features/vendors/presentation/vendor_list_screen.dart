import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/filter_action_button.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/hatly_text_field.dart';
import '../../../shared_widgets/sort_menu_button.dart';
import '../data/vendor_providers.dart';
import '../domain/vendor_filters.dart';
import '../../home/data/home_address_provider.dart';
import 'widgets/vendor_card.dart';
import 'widgets/vendor_card_skeleton.dart';
import 'widgets/subcategory_chip_row.dart';
import 'widgets/vendor_filter_sheet.dart';

class VendorListScreen extends ConsumerStatefulWidget {
  const VendorListScreen({super.key, this.category, this.categoryName});

  /// A real MarketplaceSector id now (despite the legacy param name,
  /// kept to match `vendorListProvider`'s existing `.family<..., String?>`
  /// key type without changing its signature) — or null for the
  /// unfiltered "all vendors" list (Home's own preview shape; no
  /// sort/search UI is shown in that case — CONFIRMED: search/sort are
  /// always scoped to a specific sector, never a global cross-sector
  /// view).
  final String? category;

  /// The sector's already-localized display name, carried from
  /// wherever the customer selected it (see HomeCategorySection) —
  /// replaces the old fixture-only `categoryLabel(context, category)`
  /// lookup, which only ever worked for the hardcoded fixture slugs
  /// and would have shown a raw UUID for a real sector id.
  final String? categoryName;

  @override
  ConsumerState<VendorListScreen> createState() => _VendorListScreenState();
}

class _VendorListScreenState extends ConsumerState<VendorListScreen> {
  String? _sortOption;
  String _searchQuery = '';
  // Consolidated customer-commerce milestone, Part E.
  String? _selectedSubcategoryId;
  // Filters V1. The committed/active filter state — the filter sheet
  // only ever replaces this wholesale, on Apply.
  VendorFilters _filters = VendorFilters.empty;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final title = widget.categoryName ?? l10n.vendorsNearYou;
    final sectorId = widget.category;

    // No sector to scope a paginated/sortable/searchable query to —
    // falls back to the original simple unfiltered preview shape
    // (Home's own use case), never a global cross-sector search.
    if (sectorId == null) {
      return Scaffold(
        appBar: AppBar(title: Text(title)),
        body: _LegacyUnfilteredVendorList(),
      );
    }

    final key = (
      sectorId: sectorId,
      sort: _sortOption,
      search: _searchQuery.isEmpty ? null : _searchQuery,
      // LAUNCH TRACK L1-A: real coordinates only, never fabricated —
      // `homeActiveAddressProvider`'s own null-when-no-address
      // contract is preserved end-to-end into this key.
      latitude: ref.watch(homeActiveAddressProvider).valueOrNull?.latitude,
      longitude: ref.watch(homeActiveAddressProvider).valueOrNull?.longitude,
      subcategoryId: _selectedSubcategoryId,
      openNow: _filters.openNow,
      hasOffers: _filters.hasOffers,
      minRating: _filters.minRating,
    );
    final vendorsAsync = ref.watch(vendorListControllerProvider(key));

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: HatlySpacing.sm),
            child: SubcategoryChipRow(
              sectorId: sectorId,
              selectedSubcategoryId: _selectedSubcategoryId,
              onChanged: (subcategoryId) =>
                  setState(() => _selectedSubcategoryId = subcategoryId),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(HatlySpacing.md, HatlySpacing.ms,
                HatlySpacing.md, HatlySpacing.sm),
            child: Row(
              children: [
                Expanded(
                  child: HatlyTextField(
                    isSearch: true,
                    hintText: l10n.searchHint,
                    onChanged: (value) => setState(() => _searchQuery = value),
                  ),
                ),
                const SizedBox(width: HatlySpacing.sm),
                FilterActionButton(
                  key: const Key('vendor-filter-action'),
                  label: l10n.filterAction,
                  activeCount: _filters.activeCount,
                  onTap: () async {
                    final result = await showModalBottomSheet<VendorFilters>(
                      context: context,
                      isScrollControlled: true,
                      builder: (_) => VendorFilterSheet(initialFilters: _filters),
                    );
                    // A null result means Cancel/dismiss — the previous active
                    // filter state is left completely untouched.
                    if (result != null) setState(() => _filters = result);
                  },
                ),
                const SizedBox(width: HatlySpacing.sm),
                SortMenuButton(
                  value: _sortOption,
                  label: l10n.sortNewest,
                  onChanged: (sort) => setState(() => _sortOption = sort),
                  options: [
                    ('newest', l10n.sortNewest),
                    ('highestRated', l10n.sortHighestRated),
                    ('offers', l10n.sortOffers),
                  ],
                ),
              ],
            ),
          ),
          Expanded(
            child: vendorsAsync.when(
              loading: () => ListView.builder(
                padding: const EdgeInsets.symmetric(vertical: HatlySpacing.sm),
                itemCount: 5,
                itemBuilder: (context, index) => const VendorCardSkeleton(),
              ),
              error: (error, stackTrace) => HatlyStateView(
                icon: Icons.wifi_off_rounded,
                title: l10n.somethingWentWrong,
                retryLabel: l10n.retry,
                onRetry: () => ref
                    .read(vendorListControllerProvider(key).notifier)
                    .refresh(),
              ),
              data: (vendors) {
                if (vendors.isEmpty) {
                  return HatlyStateView(
                    icon: Icons.storefront_outlined,
                    title: l10n.noVendorsFound,
                    subtitle: l10n.noVendorsFoundSubtitle,
                  );
                }
                return RefreshIndicator(
                  onRefresh: () => ref
                      .read(vendorListControllerProvider(key).notifier)
                      .refresh(),
                  child: NotificationListener<ScrollNotification>(
                    onNotification: (notification) {
                      final nearBottom = notification.metrics.pixels >=
                          notification.metrics.maxScrollExtent - 200;
                      if (nearBottom) {
                        ref
                            .read(vendorListControllerProvider(key).notifier)
                            .loadMore();
                      }
                      return false;
                    },
                    child: ListView.separated(
                      padding: const EdgeInsets.all(HatlySpacing.md),
                      itemCount: vendors.length,
                      separatorBuilder: (context, index) =>
                          const SizedBox(height: HatlySpacing.xs),
                      itemBuilder: (context, index) {
                        final vendor = vendors[index];
                        return VendorCard(
                          vendor: vendor,
                          onTap: () => context.push('/vendors/${vendor.id}'),
                        );
                      },
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

/// The original, pre-Discovery unfiltered vendor list — unchanged
/// behavior, kept only for the (rare) sector-less navigation case.
class _LegacyUnfilteredVendorList extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final vendorsAsync = ref.watch(vendorListProvider(null));

    return vendorsAsync.when(
      loading: () => ListView.builder(
        padding: const EdgeInsets.symmetric(vertical: HatlySpacing.sm),
        itemCount: 5,
        itemBuilder: (context, index) => const VendorCardSkeleton(),
      ),
      error: (error, stackTrace) => HatlyStateView(
        icon: Icons.wifi_off_rounded,
        title: l10n.somethingWentWrong,
        retryLabel: l10n.retry,
        onRetry: () => ref.invalidate(vendorListProvider(null)),
      ),
      data: (vendors) {
        if (vendors.isEmpty) {
          return HatlyStateView(
            icon: Icons.storefront_outlined,
            title: l10n.noVendorsFound,
            subtitle: l10n.noVendorsFoundSubtitle,
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.all(HatlySpacing.md),
          itemCount: vendors.length,
          separatorBuilder: (context, index) =>
              const SizedBox(height: HatlySpacing.xs),
          itemBuilder: (context, index) {
            final vendor = vendors[index];
            return VendorCard(
              vendor: vendor,
              onTap: () => context.push('/vendors/${vendor.id}'),
            );
          },
        );
      },
    );
  }
}
