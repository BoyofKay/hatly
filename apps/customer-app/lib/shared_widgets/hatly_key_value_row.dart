import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';
import 'ltr_text.dart';

/// `label ........ value` on one line: the label takes the room it needs and wraps; the value keeps its natural width (up to
/// 60% of the row) and sits at the far end. [ltr] forces the value left-to-right (amounts, ids, distances).
class HatlyKeyValueRow extends StatelessWidget {
  const HatlyKeyValueRow({
    super.key,
    required this.label,
    required this.value,
    this.ltr = true,
    this.style,
    this.valueKey,
    this.padding = const EdgeInsets.symmetric(vertical: 3),
  });

  final String label;
  final String value;
  final bool ltr;
  final TextStyle? style;
  final Key? valueKey;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final textStyle = style ?? context.type.body;
    return Padding(
      padding: padding,
      child: LayoutBuilder(
        builder: (context, box) => Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: Text(label, style: textStyle)),
            const SizedBox(width: HatlySpacing.sm),
            ConstrainedBox(
              constraints: BoxConstraints(maxWidth: box.maxWidth * 0.6),
              child: ltr
                  ? LtrText(value,
                      key: valueKey, style: textStyle, textAlign: TextAlign.end)
                  : Text(value,
                      key: valueKey,
                      style: textStyle,
                      textAlign: TextAlign.end),
            ),
          ],
        ),
      ),
    );
  }
}

/// `leading ...... trailing`: the leading part takes the remaining room, the trailing one (a badge, a price) keeps its natural
/// width — up to 50% of the row — and sits at the far end.
class HatlyTrailingRow extends StatelessWidget {
  const HatlyTrailingRow({
    super.key,
    required this.leading,
    required this.trailing,
    this.crossAxisAlignment = CrossAxisAlignment.center,
  });

  final Widget leading;
  final Widget trailing;
  final CrossAxisAlignment crossAxisAlignment;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, box) => Row(
        crossAxisAlignment: crossAxisAlignment,
        children: [
          Expanded(child: leading),
          const SizedBox(width: HatlySpacing.sm),
          ConstrainedBox(
            constraints: BoxConstraints(maxWidth: box.maxWidth * 0.5),
            child: trailing,
          ),
        ],
      ),
    );
  }
}

/// The filled call-to-action style for NEW components: dark ink on the brand orange (7:1) instead of the legacy white
/// (2.6:1); disabled state stays the theme's own.
ButtonStyle hatlyAccentButtonStyle(BuildContext context) {
  final p = context.palette;
  return ButtonStyle(
    foregroundColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.disabled) ? null : p.accentOn),
  );
}
