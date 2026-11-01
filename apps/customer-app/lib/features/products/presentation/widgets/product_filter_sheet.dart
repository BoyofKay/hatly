import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/hatly_primary_button.dart';
import '../../domain/product_filters.dart';

/// Filters V1 — the Product List "فلترة" (Filter) bottom sheet. Same
/// local-draft-until-Apply discipline as `VendorFilterSheet` — see
/// that file's own doc comment, identical reasoning here.
///
/// Price bounds ([minAvailablePriceMinor]/[maxAvailablePriceMinor]) are
/// the REAL min/max price across the vendor's own currently-loaded
/// product list (computed by the caller from real data it already
/// fetched) — shown as field hints only, never a hardcoded/arbitrary
/// business limit, and never a second network call just for this.
class ProductFilterSheet extends StatefulWidget {
  const ProductFilterSheet({
    super.key,
    required this.initialFilters,
    this.minAvailablePriceMinor,
    this.maxAvailablePriceMinor,
  });

  final ProductFilters initialFilters;
  final int? minAvailablePriceMinor;
  final int? maxAvailablePriceMinor;

  @override
  State<ProductFilterSheet> createState() => _ProductFilterSheetState();
}

class _ProductFilterSheetState extends State<ProductFilterSheet> {
  late ProductFilters _draft = widget.initialFilters;
  late final _minController = TextEditingController(
      text: _minorToWhole(widget.initialFilters.minPriceMinor));
  late final _maxController = TextEditingController(
      text: _minorToWhole(widget.initialFilters.maxPriceMinor));

  String _minorToWhole(int? minor) =>
      minor == null ? '' : (minor / 100).round().toString();
  int? _wholeToMinor(String text) {
    final value = int.tryParse(text.trim());
    return value == null ? null : value * 100;
  }

  @override
  void dispose() {
    _minController.dispose();
    _maxController.dispose();
    super.dispose();
  }

  void _clearAll() {
    setState(() {
      _draft = ProductFilters.empty;
      _minController.clear();
      _maxController.clear();
    });
  }

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
            toggled: _draft.availableOnly,
            child: SwitchListTile.adaptive(
              key: const Key('product-filter-available-only'),
              contentPadding: EdgeInsets.zero,
              title: Text(l10n.filterAvailableOnly, style: context.type.body),
              value: _draft.availableOnly,
              onChanged: (value) => setState(
                  () => _draft = _draft.copyWith(availableOnly: value)),
            ),
          ),
          Semantics(
            toggled: _draft.hasOffers,
            child: SwitchListTile.adaptive(
              key: const Key('product-filter-has-offers'),
              contentPadding: EdgeInsets.zero,
              title: Text(l10n.filterHasOffers, style: context.type.body),
              value: _draft.hasOffers,
              onChanged: (value) =>
                  setState(() => _draft = _draft.copyWith(hasOffers: value)),
            ),
          ),
          const SizedBox(height: HatlySpacing.sm),
          Text(l10n.filterPriceRangeLabel,
              style: context.type.caption.copyWith(color: p.textMuted)),
          const SizedBox(height: HatlySpacing.xs),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('product-filter-price-min'),
                  controller: _minController,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  onChanged: (text) => setState(() => _draft =
                      _draft.copyWith(minPriceMinor: _wholeToMinor(text))),
                  decoration: InputDecoration(
                    labelText: l10n.filterPriceMinHint,
                    hintText: widget.minAvailablePriceMinor != null
                        ? formatMinorUnits(
                            widget.minAvailablePriceMinor!, context)
                        : null,
                    border: const OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: HatlySpacing.sm),
              Expanded(
                child: TextField(
                  key: const Key('product-filter-price-max'),
                  controller: _maxController,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  onChanged: (text) => setState(() => _draft =
                      _draft.copyWith(maxPriceMinor: _wholeToMinor(text))),
                  decoration: InputDecoration(
                    labelText: l10n.filterPriceMaxHint,
                    hintText: widget.maxAvailablePriceMinor != null
                        ? formatMinorUnits(
                            widget.maxAvailablePriceMinor!, context)
                        : null,
                    border: const OutlineInputBorder(),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: HatlySpacing.lg),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              TextButton(
                key: const Key('product-filter-clear-all'),
                onPressed: _clearAll,
                child: Text(l10n.clearAll),
              ),
              TextButton(
                key: const Key('product-filter-cancel'),
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
