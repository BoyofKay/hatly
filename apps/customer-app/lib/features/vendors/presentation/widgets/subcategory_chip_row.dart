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

const double _kChipHeight = 44;
const double _kChipImage = 28;

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
    // One line of label at the user's text size (clamped like the other rows) so the strip never clips a larger font.
    final textScale =
        MediaQuery.textScalerOf(context).scale(14).clamp(14.0, 28.0) / 14;
    final height = (_kChipHeight * textScale).clamp(_kChipHeight, 72.0) + 8;

    return SizedBox(
      height: height,
      // A short row of light pills: a plain scrolling Row (not a lazy list) so every pill is always in the tree — none goes missing just
      // because it is scrolled out of view (tests, accessibility traversal).
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
            horizontal: HatlySpacing.md, vertical: 4),
        child: Row(
          children: [
            _SubcategoryItem(
              key: const Key('subcategory-chip-all'),
              label: l10n.allProducts,
              imageUrl: null,
              placeholderIcon: Icons.apps_rounded,
              selected: selectedSubcategoryId == null,
              onTap: () => onChanged(null),
            ),
            for (final subcategory in subcategories) ...[
              const SizedBox(width: HatlySpacing.sm),
              _SubcategoryItem(
                key: Key('subcategory-chip-${subcategory.id}'),
                label: isArabic && subcategory.nameAr != null
                    ? subcategory.nameAr!
                    : subcategory.name,
                imageUrl: subcategory.imageUrl,
                placeholderIcon: Icons.category_outlined,
                selected: selectedSubcategoryId == subcategory.id,
                onTap: () => onChanged(subcategory.id),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A compact pill: the selected one is filled orange, the others are white with a hairline border. A small round image (or the soft orange
/// glyph) leads the label.
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
    final radius = BorderRadius.circular(HatlyRadius.circular);

    return Semantics(
      button: true,
      selected: selected,
      label: label,
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        color: selected ? p.accent : p.surface,
        shape: RoundedRectangleBorder(
          borderRadius: radius,
          side: BorderSide(color: selected ? p.accent : p.border),
        ),
        child: InkWell(
          borderRadius: radius,
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: _kChipHeight),
            child: Padding(
              padding: const EdgeInsetsDirectional.fromSTEB(HatlySpacing.sm,
                  HatlySpacing.xs, HatlySpacing.md, HatlySpacing.xs),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  HatlySoftImage(
                    url: imageUrl,
                    width: _kChipImage,
                    height: _kChipImage,
                    circular: true,
                    placeholderIcon: placeholderIcon,
                    placeholderIconSize: 16,
                  ),
                  const SizedBox(width: HatlySpacing.sm),
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: context.type.small.copyWith(
                      color: selected ? p.accentOn : p.textPrimary,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
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
