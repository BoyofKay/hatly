import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../sectors/data/sectors_providers.dart';
import '../../../sectors/domain/subcategory.dart';

/// The visual MarketplaceSubcategory (Level 1.5) row near the top of a
/// sector's vendor listing: a compact horizontal strip of small surface cards,
/// each a rounded image + the category name, with "All" always first as the
/// reset option. Replaces the former text-only chips.
///
/// This is only the presentation of MarketplaceSubcategory — it is unrelated
/// to a vendor's own ProductCategory (Level 2, the chips on the vendor menu).
/// Images come from `MarketplaceSubcategory.imageUrl` through the shared
/// image widget (`HatlySoftImage` → `resolveMediaUrl`), so a missing, blank or
/// failed image falls back to the quiet placeholder icon, never a broken box.
///
/// CONFIRMED: selecting an item filters the EXISTING vendor/branch listing
/// (the `subcategoryId` query) — it never turns this screen into a product
/// list. Loading/error/empty are all handled by simply not showing the row (a
/// secondary, optional filter is not worth a scary error banner or a
/// layout-shifting skeleton on the primary vendor list beneath it); the vendor
/// list itself still has its own full loading/error/empty handling, unaffected
/// by this row's own state.
class SubcategoryChipRow extends ConsumerWidget {
  const SubcategoryChipRow({
    super.key,
    required this.sectorId,
    required this.selectedSubcategoryId,
    required this.onChanged,
  });

  final String sectorId;
  final String? selectedSubcategoryId;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final subcategoriesAsync = ref.watch(subcategoriesProvider(sectorId));

    return subcategoriesAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (subcategories) {
        if (subcategories.isEmpty) return const SizedBox.shrink();
        return _SubcategoryStrip(
          subcategories: subcategories,
          selectedSubcategoryId: selectedSubcategoryId,
          onChanged: onChanged,
        );
      },
    );
  }
}

const double _kImageSize = 56;
const double _kItemWidth = 84;

class _SubcategoryStrip extends StatelessWidget {
  const _SubcategoryStrip({
    required this.subcategories,
    required this.selectedSubcategoryId,
    required this.onChanged,
  });

  final List<MarketplaceSubcategory> subcategories;
  final String? selectedSubcategoryId;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    // Two label lines at the user's text size (clamped like the other rows)
    // so the strip never clips a larger font.
    final textScale =
        MediaQuery.textScalerOf(context).scale(12).clamp(12.0, 24.0) / 12;
    final height = _kImageSize +
        HatlySpacing.sm * 3 + // card padding top/bottom + image→label gap
        2 * 12 * 1.35 * textScale +
        4; // selected border allowance

    return SizedBox(
      height: height,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
            horizontal: HatlySpacing.md, vertical: 2),
        itemCount: subcategories.length + 1,
        separatorBuilder: (context, index) =>
            const SizedBox(width: HatlySpacing.sm),
        itemBuilder: (context, index) {
          if (index == 0) {
            return _SubcategoryItem(
              key: const Key('subcategory-chip-all'),
              label: l10n.allProducts,
              imageUrl: null,
              placeholderIcon: Icons.apps_rounded,
              selected: selectedSubcategoryId == null,
              onTap: () => onChanged(null),
            );
          }
          final subcategory = subcategories[index - 1];
          return _SubcategoryItem(
            key: Key('subcategory-chip-${subcategory.id}'),
            label: isArabic && subcategory.nameAr != null
                ? subcategory.nameAr!
                : subcategory.name,
            imageUrl: subcategory.imageUrl,
            placeholderIcon: Icons.category_outlined,
            selected: selectedSubcategoryId == subcategory.id,
            onTap: () => onChanged(subcategory.id),
          );
        },
      ),
    );
  }
}

class _SubcategoryItem extends StatelessWidget {
  const _SubcategoryItem({
    super.key,
    required this.label,
    required this.imageUrl,
    required this.placeholderIcon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String? imageUrl;
  final IconData placeholderIcon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final radius = BorderRadius.circular(HatlyRadius.card);

    return Semantics(
      button: true,
      selected: selected,
      label: label,
      onTap: onTap,
      excludeSemantics: true,
      child: SizedBox(
        width: _kItemWidth,
        child: Material(
          color: p.surface,
          shape: RoundedRectangleBorder(
            borderRadius: radius,
            side: BorderSide(
              color: selected ? p.accent : p.border,
              width: selected ? 2 : 1,
            ),
          ),
          child: InkWell(
            borderRadius: radius,
            onTap: onTap,
            child: ConstrainedBox(
              constraints:
                  const BoxConstraints(minHeight: HatlyTouch.minTarget),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(HatlySpacing.xs,
                    HatlySpacing.sm, HatlySpacing.xs, HatlySpacing.sm),
                child: Column(
                  children: [
                    HatlySoftImage(
                      url: imageUrl,
                      width: _kImageSize,
                      height: _kImageSize,
                      radius: HatlyRadius.imageContainer - 4,
                      placeholderIcon: placeholderIcon,
                      placeholderIconSize: 26,
                    ),
                    const SizedBox(height: HatlySpacing.xs),
                    Expanded(
                      child: Center(
                        child: Text(
                          label,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: context.type.small.copyWith(
                            height: 1.35,
                            color: p.textPrimary,
                            fontWeight:
                                selected ? FontWeight.w700 : FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
