import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_primary_button.dart';
import '../../domain/vendor_filters.dart';

/// Filters V1 — the Vendor List "فلترة" (Filter) bottom sheet. Edits
/// its OWN local draft copy of [VendorFilters]; the active filter
/// state held by the parent screen is only ever replaced when this
/// sheet is popped with a result (`تطبيق` — Apply). Popping with `null`
/// (`إلغاء`/Cancel, swipe-to-dismiss, tapping outside) changes nothing
/// — the parent's own previous state is simply never touched.
/// "مسح الكل" (Clear All) only resets THIS draft, not the parent's
/// active state — still requires `تطبيق` to actually take effect,
/// keeping one single, predictable commit point.
class VendorFilterSheet extends StatefulWidget {
  const VendorFilterSheet({super.key, required this.initialFilters});

  final VendorFilters initialFilters;

  @override
  State<VendorFilterSheet> createState() => _VendorFilterSheetState();
}

class _VendorFilterSheetState extends State<VendorFilterSheet> {
  late VendorFilters _draft = widget.initialFilters;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;

    return Padding(
      padding: EdgeInsets.only(
        left: HatlySpacing.md,
        right: HatlySpacing.md,
        top: HatlySpacing.md,
        bottom: MediaQuery.of(context).viewInsets.bottom + HatlySpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l10n.filterAction, style: context.type.title),
          const SizedBox(height: HatlySpacing.md),
          Semantics(
            toggled: _draft.openNow,
            child: SwitchListTile.adaptive(
              key: const Key('vendor-filter-open-now'),
              contentPadding: EdgeInsets.zero,
              title: Text(l10n.filterOpenNow, style: context.type.body),
              value: _draft.openNow,
              onChanged: (value) =>
                  setState(() => _draft = _draft.copyWith(openNow: value)),
            ),
          ),
          Semantics(
            toggled: _draft.hasOffers,
            child: SwitchListTile.adaptive(
              key: const Key('vendor-filter-has-offers'),
              contentPadding: EdgeInsets.zero,
              title: Text(l10n.filterHasOffers, style: context.type.body),
              value: _draft.hasOffers,
              onChanged: (value) =>
                  setState(() => _draft = _draft.copyWith(hasOffers: value)),
            ),
          ),
          const SizedBox(height: HatlySpacing.sm),
          Text(l10n.filterRatingLabel,
              style: context.type.caption.copyWith(color: p.textMuted)),
          const SizedBox(height: HatlySpacing.xs),
          Wrap(
            spacing: HatlySpacing.xs,
            children: [
              _RatingChip(
                key: const Key('vendor-filter-rating-any'),
                label: l10n.filterRatingAny,
                selected: _draft.minRating == null,
                onTap: () =>
                    setState(() => _draft = _draft.copyWith(minRating: null)),
              ),
              _RatingChip(
                key: const Key('vendor-filter-rating-4'),
                label: l10n.filterRating4Plus,
                selected: _draft.minRating == 4,
                onTap: () =>
                    setState(() => _draft = _draft.copyWith(minRating: 4)),
              ),
              _RatingChip(
                key: const Key('vendor-filter-rating-3'),
                label: l10n.filterRating3Plus,
                selected: _draft.minRating == 3,
                onTap: () =>
                    setState(() => _draft = _draft.copyWith(minRating: 3)),
              ),
            ],
          ),
          const SizedBox(height: HatlySpacing.lg),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              TextButton(
                key: const Key('vendor-filter-clear-all'),
                onPressed: () => setState(() => _draft = VendorFilters.empty),
                child: Text(l10n.clearAll),
              ),
              TextButton(
                key: const Key('vendor-filter-cancel'),
                onPressed: () => Navigator.of(context).pop(),
                child: Text(l10n.cancel),
              ),
            ],
          ),
          const SizedBox(height: HatlySpacing.sm),
          HatlyPrimaryButton(
            label: l10n.apply,
            onPressed: () => Navigator.of(context).pop(_draft),
          ),
        ],
      ),
    );
  }
}

class _RatingChip extends StatelessWidget {
  const _RatingChip(
      {super.key,
      required this.label,
      required this.selected,
      required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => onTap(),
      selectedColor: HatlyColors.primaryOrange,
      // Polish pass: was hardcoded `Colors.white` on the selected (brand-orange)
      // fill — 2.6:1 contrast, fails accessibility (hatly_palette.dart's own
      // documented rule). `p.accentOn` is the correct dark ink (7:1).
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
