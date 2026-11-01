import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../domain/product_option.dart';

/// One real option group of a product, as a radio group (single-select) or checkbox group (multi-select).
/// CONTROLLED: the selection lives in the screen's `ProductConfiguration`, so validation and the estimated
/// total have one source of truth. "Required" is a text badge (never colour alone); when [showError] is set
/// a required group with nothing selected says so in words.
class ProductOptionGroup extends StatelessWidget {
  const ProductOptionGroup({
    super.key,
    required this.option,
    required this.selected,
    required this.onToggle,
    this.showError = false,
  });

  final ProductOption option;
  final Set<String> selected;
  final ValueChanged<String> onToggle;
  final bool showError;

  /// "Choose 2 to 4" / "Choose at least 2" / "Choose up to 3" — only when the group has limits beyond the plain required /
  /// single-choice cases (those are already obvious from the radio buttons and the "required" badge).
  String? _limitsHint(AppLocalizations l10n) {
    if (!option.allowsMultiple) return null;
    final min = option.effectiveMin;
    final max = option.effectiveMax;
    if (max != null && min > 0 && min != max) {
      return l10n.optionChooseBetween(min, max);
    }
    if (max != null) return l10n.optionChooseUpTo(max);
    if (min > 1) return l10n.optionChooseAtLeast(min);
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final title =
        isArabic && option.nameAr != null ? option.nameAr! : option.name;

    return Semantics(
      container: true,
      label: title,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Flexible(
                child: Text(title,
                    style: context.type.body.copyWith(
                        color: p.textPrimary, fontWeight: FontWeight.w700)),
              ),
              if (option.isRequired) ...[
                const SizedBox(width: HatlySpacing.sm),
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: p.accentSoft,
                    borderRadius: BorderRadius.circular(HatlyRadius.chip),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: HatlySpacing.sm, vertical: 2),
                    child: Text(l10n.optionRequiredBadge,
                        style: context.type.caption.copyWith(
                            color: p.link, fontWeight: FontWeight.w700)),
                  ),
                ),
              ],
            ],
          ),
          if (_limitsHint(l10n) != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(_limitsHint(l10n)!,
                  key: Key('option-limits-${option.id}'),
                  style: context.type.caption.copyWith(color: p.textMuted)),
            ),
          for (final value in option.values)
            _ValueRow(
              option: option,
              valueId: value.id,
              name:
                  isArabic && value.nameAr != null ? value.nameAr! : value.name,
              deltaMinor: value.priceDeltaMinor,
              selected: selected.contains(value.id),
              // At the maximum, the values not yet chosen are visibly unavailable (the model also refuses the tap).
              atMax: option.allowsMultiple &&
                  option.effectiveMax != null &&
                  selected.length >= option.effectiveMax! &&
                  !selected.contains(value.id),
              onTap: () => onToggle(value.id),
            ),
          if (showError &&
              selected.isNotEmpty &&
              selected.length < option.effectiveMin)
            Padding(
              padding: const EdgeInsets.only(top: HatlySpacing.xs),
              child: Row(
                children: [
                  Icon(Icons.error_outline_rounded, size: 16, color: p.urgent),
                  const SizedBox(width: HatlySpacing.xs),
                  Flexible(
                    child: Text(l10n.optionMinError(option.effectiveMin),
                        key: Key('option-min-error-${option.id}'),
                        style: context.type.small.copyWith(color: p.urgent)),
                  ),
                ],
              ),
            ),
          if (showError && option.isRequired && selected.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: HatlySpacing.xs),
              child: Row(
                children: [
                  Icon(Icons.error_outline_rounded, size: 16, color: p.urgent),
                  const SizedBox(width: HatlySpacing.xs),
                  Flexible(
                    child: Text(l10n.optionRequiredError,
                        style: context.type.small.copyWith(color: p.urgent)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _ValueRow extends StatelessWidget {
  const _ValueRow({
    this.atMax = false,
    required this.option,
    required this.valueId,
    required this.name,
    required this.deltaMinor,
    required this.selected,
    required this.onTap,
  });

  final ProductOption option;
  final String valueId;
  final String name;
  final int deltaMinor;
  final bool selected;
  final bool atMax;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final multi = option.allowsMultiple;
    final icon = multi
        ? (selected
            ? Icons.check_box_rounded
            : Icons.check_box_outline_blank_rounded)
        : (selected
            ? Icons.radio_button_checked_rounded
            : Icons.radio_button_off_rounded);

    return Semantics(
      checked: multi ? selected : null,
      selected: multi ? null : selected,
      inMutuallyExclusiveGroup: !multi,
      button: true,
      onTap: onTap,
      enabled: !atMax,
      label: deltaMinor != 0
          ? '$name، ${deltaMinor > 0 ? '+' : ''}${formatMinorUnits(deltaMinor, context)}'
          : name,
      excludeSemantics: true,
      child: Opacity(
        opacity: atMax ? 0.45 : 1,
        child: InkWell(
          borderRadius: BorderRadius.circular(HatlyRadius.chip),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: HatlyTouch.minTarget),
            child: Row(
              children: [
                Icon(icon, size: 24, color: selected ? p.accent : p.textMuted),
                const SizedBox(width: HatlySpacing.ms),
                // The price delta sits right after the name, so it clearly belongs to this option.
                Flexible(
                  child: Text(name,
                      style: context.type.small.copyWith(color: p.textPrimary)),
                ),
                if (deltaMinor != 0) ...[
                  const SizedBox(width: HatlySpacing.sm),
                  LtrText(
                      '${deltaMinor > 0 ? '+' : ''}${formatMinorUnits(deltaMinor, context)}',
                      style: context.type.small.copyWith(color: p.textMuted)),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
