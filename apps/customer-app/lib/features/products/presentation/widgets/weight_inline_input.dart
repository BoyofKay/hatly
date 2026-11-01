import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/weight_selector.dart';

/// Type a weight straight into the product page (kilograms, up to three decimals — "1.25" is 1 250 g), kept in step with the presets and
/// the − / + stepper above it. A value outside [minGrams, maxGrams] is explained under the field and never sent on; the grams the page
/// holds only change for a valid amount, so the estimate and the add-to-cart weight can never disagree with what is shown.
class WeightInlineInput extends StatefulWidget {
  const WeightInlineInput({
    super.key,
    required this.grams,
    required this.minGrams,
    required this.maxGrams,
    required this.onChanged,
  });

  final int grams;
  final int minGrams;
  final int maxGrams;
  final ValueChanged<int> onChanged;

  @override
  State<WeightInlineInput> createState() => _WeightInlineInputState();
}

String _kg(int grams) =>
    (grams / 1000).toStringAsFixed(3).replaceFirst(RegExp(r'\.?0+$'), '');

class _WeightInlineInputState extends State<WeightInlineInput> {
  late final TextEditingController _controller =
      TextEditingController(text: _kg(widget.grams));
  final _focus = FocusNode();
  bool _invalid = false;

  @override
  void didUpdateWidget(WeightInlineInput old) {
    super.didUpdateWidget(old);
    // A preset or the stepper moved the weight: show it — unless the customer is mid-typing something that already means this weight.
    if (widget.grams != old.grams &&
        parseKilogramsToGrams(_controller.text) != widget.grams) {
      _controller.text = _kg(widget.grams);
      _invalid = false;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _typed(String text) {
    final grams = parseKilogramsToGrams(text);
    final ok =
        grams != null && grams >= widget.minGrams && grams <= widget.maxGrams;
    setState(() => _invalid = !ok && text.trim().isNotEmpty);
    if (ok) widget.onChanged(grams);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return TextField(
      key: const Key('weight-inline-field'),
      controller: _controller,
      focusNode: _focus,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      textInputAction: TextInputAction.done,
      inputFormatters: [
        FilteringTextInputFormatter.allow(RegExp(r'[0-9٠-٩.,٫]'))
      ],
      onChanged: _typed,
      onSubmitted: (_) {
        // On "done" with something invalid, put the last good weight back so the field never disagrees with the page.
        if (_invalid) {
          _controller.text = _kg(widget.grams);
          setState(() => _invalid = false);
        }
      },
      decoration: InputDecoration(
        labelText: l10n.weightInlineLabel,
        suffixText: 'kg',
        isDense: true,
        errorText: _invalid
            ? l10n.weightEntryInvalid(weightShortLabel(widget.minGrams, l10n),
                weightShortLabel(widget.maxGrams, l10n))
            : null,
        errorStyle: context.type.small.copyWith(color: p.urgent),
      ),
    );
  }
}
