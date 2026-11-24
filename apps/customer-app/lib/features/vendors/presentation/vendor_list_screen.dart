import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/filter_action_button.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/hatly_text_field.dart';
import '../../../shared_widgets/hatly_soft_image.dart';
import '../../../shared_widgets/hero_colors.dart';
import '../../sectors/data/sectors_providers.dart';
import '../../../shared_widgets/sort_menu_button.dart';
import '../data/vendor_providers.dart';
import '../domain/vendor_filters.dart';
import '../../home/data/home_address_provider.dart';
import 'widgets/vendor_card.dart';
import 'widgets/vendor_card_skeleton.dart';
import 'widgets/subcategory_chip_row.dart';
import 'widgets/vendor_filter_sheet.dart';
import '../../home/presentation/widgets/hatly_service_entry_card.dart';

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
    final sectors = ref.watch(sectorsProvider).valueOrNull ?? const [];
    final match = sectors.where((s) => s.id == sectorId);
    final bannerUrl = match.isEmpty ? null : match.first.bannerUrl;
    final sectorTint = match.isEmpty ? colorForSector(null, null) : colorForSector(match.first.slug, match.first.accentColor);

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
      deliveryZoneId:
          ref.watch(homeActiveAddressProvider).valueOrNull?.deliveryZoneId,
      subcategoryId: _selectedSubcategoryId,
      openNow: _filters.openNow,
      hasOffers: _filters.hasOffers,
      minRating: _filters.minRating,
    );
    final vendorsAsync = ref.watch(vendorListControllerProvider(key));

    return Scaffold(
      // Sector pages always offer the standalone Hatly purchase service,
      // including when no vendors are returned. Not linked to any store.
      bottomNavigationBar: const SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.only(bottom: HatlySpacing.sm),
          child: HatlyServiceEntryCard(buyFromPlaceOnly: true),
        ),
      ),
      body: Column(
        children: [
          ClipRRect(
            borderRadius: const BorderRadius.vertical(bottom: Radius.circular(14)),
            child: SizedBox(
              height: MediaQuery.sizeOf(context).width * 9 / 16,
              width: double.infinity,
              child: Stack(fit: StackFit.expand, children: [
                ColoredBox(color: translucentHero(sectorTint, Theme.of(context).scaffoldBackgroundColor)),
                if (bannerUrl != null)
                  HatlySoftImage(url: bannerUrl, width: double.infinity, height: MediaQuery.sizeOf(context).width * 9 / 16,
                    radius: 0, placeholderIcon: Icons.storefront_outlined),
                const DecoratedBox(decoration: BoxDecoration(
                  gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter,
                    stops: [0, 0.45, 1],
                    colors: [Color(0x66000000), Color(0x00000000), Color(0x88000000)]))),
                PositionedDirectional(
                  start: 12, top: 6,
                  child: Material(color: const Color(0xAA000000), shape: const CircleBorder(),
                    child: IconButton(
                      key: const Key('sector-hero-back'), tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                      icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
                      onPressed: () => Navigator.of(context).maybePop(),
                    )),
                ),
                PositionedDirectional(start: 20, end: 20, bottom: 16,
                  child: Text(title, maxLines: 2, overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800, color: Colors.white))),
              ]),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: HatlySpacing.xs),
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
                    hintText: Localizations.localeOf(context).languageCode == 'ar' ? 'ابحث عن متجر' : 'Search stores',
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
                      builder: (_) =>
                          VendorFilterSheet(initialFilters: _filters),
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
                  return _SectorEmptyState(hasFilters: _searchQuery.trim().isNotEmpty || _selectedSubcategoryId != null || _filters.activeCount > 0);
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

/// An empty sector still offers the fixed Hatly Service card below.
/// Distinguishes no merchants in the sector from a zero-result filter.
class _SectorEmptyState extends StatelessWidget {
  const _SectorEmptyState({required this.hasFilters});
  final bool hasFilters;

  @override
  Widget build(BuildContext context) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final p = context.palette;
    final title = hasFilters
        ? (ar ? 'مفيش متاجر مطابقة لبحثك' : 'No matching stores')
        : (ar ? 'ملقتش المحل اللي بتدور عليه؟' : "Can't find the store you're looking for?");
    final description = hasFilters
        ? (ar
            ? 'جرّب تغيير البحث أو الفلاتر، أو اطلب احتياجاتك بخدمة هاتلي.'
            : 'Try adjusting your search or filters, or request what you need with Hatly Service.')
        : (ar
            ? 'ولا يهمك! مع خدمة هاتلي، اطلب اللي محتاجه من أي مكان، وإحنا نجيبهولك.'
            : "No worries! With Hatly Service, you can request what you need from another place, and we'll get it for you.");
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: HatlySpacing.md, vertical: HatlySpacing.lg),
        child: Container(
          key: const Key('sector-hatly-empty-state'),
          width: double.infinity,
          padding: const EdgeInsets.all(HatlySpacing.lg),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [p.accentSoft, p.surface],
              begin: AlignmentDirectional.topStart,
              end: AlignmentDirectional.bottomEnd,
            ),
            borderRadius: BorderRadius.circular(HatlyRadius.card),
            border: Border.all(color: p.border),
            boxShadow: HatlyShadows.soft(p),
          ),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: p.surface, shape: BoxShape.circle),
              child: Icon(Icons.storefront_outlined, size: 40, color: p.accent),
            ),
            const SizedBox(height: HatlySpacing.md),
            Text(title, textAlign: TextAlign.center,
              style: context.type.title.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: HatlySpacing.sm),
            Text(description, textAlign: TextAlign.center,
              style: context.type.body.copyWith(color: p.textMuted)),
            const SizedBox(height: HatlySpacing.md),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
              decoration: BoxDecoration(color: p.accent, borderRadius: BorderRadius.circular(24)),
              child: Text(ar ? 'خدمة هاتلي ↓' : 'Hatly Service ↓',
                style: context.type.small.copyWith(color: p.accentOn, fontWeight: FontWeight.w800)),
            ),
          ]),
        ),
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
