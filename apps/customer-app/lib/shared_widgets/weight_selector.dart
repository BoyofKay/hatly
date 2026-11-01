import 'package:flutter/material.dart';
import '../core/localization/l10n/app_localizations.dart';
import '../core/theme/hatly_theme.dart';

/// Quick picks for a weighed product, in grams. Fractional weights stay possible (the − / + stepper moves in 100 g steps and the
/// value can be typed): these only save the customer ten taps to reach the common amounts.
const List<int> kQuickWeightsGrams = [250, 500, 1000, 2000];

/// The weight bounds the app lets a customer pick. The floor is the existing 100 g minimum; the ceiling is a UX sanity cap (the
/// backend independently validates every weight and stays authoritative for stock and price).
const int kMinWeightGrams = 100;
const int kMaxWeightGrams = 50000;

/// Grams from what the customer typed in KILOGRAMS ("1", "1.5", "0,25", "١٫٥"), or null when it is not a plain amount with at most
/// three decimals. Pure integer arithmetic — no `double`, so "0.3" is exactly 300 g and a total can never drift by a rounding error.
int? parseKilogramsToGrams(String input) {
  var s = input.trim();
  if (s.isEmpty) return null;
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  final buffer = StringBuffer();
  for (final rune in s.runes) {
    final ch = String.fromCharCode(rune);
    final i = arabicDigits.indexOf(ch);
    buffer.write(i >= 0 ? '$i' : (ch == '٫' || ch == ',' ? '.' : ch));
  }
  s = buffer.toString();
  final match = RegExp(r'^(\d{1,3})(?:\.(\d{1,3}))?$').firstMatch(s);
  if (match == null) return null;
  final whole = int.parse(match.group(1)!);
  final fraction = (match.group(2) ?? '').padRight(3, '0');
  return whole * 1000 + int.parse(fraction);
}

/// "250 g" / "1 kg" / "1.5 kg" (localised) for a preset or a typed weight.
String weightShortLabel(int grams, AppLocalizations l10n) {
  if (grams % 1000 == 0) return l10n.weightKgShort('${grams ~/ 1000}');
  if (grams < 1000) return l10n.weightGramsShort(grams);
  final kg = (grams / 1000).toStringAsFixed(3).replaceFirst(RegExp(r'0+$'), '');
  return l10n.weightKgShort(kg);
}

/// The preset chips under a weight stepper. A chip the product cannot supply (above the known tracked stock) is disabled.
class WeightPresetChips extends StatelessWidget {
  const WeightPresetChips({
    super.key,
    required this.selectedGrams,
    required this.onSelected,
    this.maxGrams,
  });

  final int selectedGrams;
  final int? maxGrams;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return Wrap(
      spacing: HatlySpacing.sm,
      runSpacing: HatlySpacing.xs,
      children: [
        for (final grams in kQuickWeightsGrams)
          ChoiceChip(
            key: Key('weight-preset-$grams'),
            label: Text(weightShortLabel(grams, l10n)),
            selected: selectedGrams == grams,
            labelStyle: context.type.small.copyWith(
                color: selectedGrams == grams ? p.textPrimary : p.textMuted,
                fontWeight: FontWeight.w700),
            materialTapTargetSize: MaterialTapTargetSize.padded,
            onSelected: maxGrams != null && grams > maxGrams!
                ? null
                : (_) => onSelected(grams),
          ),
      ],
    );
  }
}

/// A small dialog to TYPE a weight in kilograms. Returns the grams, or null if cancelled. Invalid input (not a number, below the
/// minimum, above the maximum / known stock) is explained and never returned.
Future<int?> showWeightEntryDialog(
  BuildContext context, {
  required int initialGrams,
  int minGrams = kMinWeightGrams,
  int? maxGrams,
}) {
  return showDialog<int>(
    context: context,
    builder: (_) => _WeightEntryDialog(
        initialGrams: initialGrams,
        minGrams: minGrams,
        maxGrams: maxGrams ?? kMaxWeightGrams),
  );
}

class _WeightEntryDialog extends StatefulWidget {
  const _WeightEntryDialog(
      {required this.initialGrams,
      required this.minGrams,
      required this.maxGrams});

  final int initialGrams;
  final int minGrams;
  final int maxGrams;

  @override
  State<_WeightEntryDialog> createState() => _WeightEntryDialogState();
}

class _WeightEntryDialogState extends State<_WeightEntryDialog> {
  late final TextEditingController _controller = TextEditingController(
      text: (widget.initialGrams / 1000)
          .toStringAsFixed(3)
          .replaceFirst(RegExp(r'\.?0+$'), ''));
  bool _showError = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final grams = parseKilogramsToGrams(_controller.text);
    if (grams == null || grams < widget.minGrams || grams > widget.maxGrams) {
      setState(() => _showError = true);
      return;
    }
    Navigator.of(context).pop(grams);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(l10n.weightEntryTitle),
      content: TextField(
        key: const Key('weight-entry-field'),
        controller: _controller,
        autofocus: true,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        textInputAction: TextInputAction.done,
        onSubmitted: (_) => _submit(),
        onChanged: (_) {
          if (_showError) setState(() => _showError = false);
        },
        decoration: InputDecoration(
          hintText: l10n.weightEntryHint,
          suffixText: 'kg',
          errorText: _showError
              ? l10n.weightEntryInvalid(weightShortLabel(widget.minGrams, l10n),
                  weightShortLabel(widget.maxGrams, l10n))
              : null,
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(l10n.cancel)),
        TextButton(
            key: const Key('weight-entry-confirm'),
            onPressed: _submit,
            child: Text(l10n.weightEntryConfirm)),
      ],
    );
  }
}
