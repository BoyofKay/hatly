import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';
import 'ltr_text.dart';

/// The approved rounded quantity control: `[ − 1 + ]`. A soft pill with two ≥44px round buttons and the
/// value between them. It knows nothing about limits — the caller passes `null` for [onDecrease] /
/// [onIncrease] when a step is not allowed (the button then looks and reads as disabled), so the real
/// stock / weight rules stay with the caller. [valueLabel] is what is shown ("1", "0.30 kg").
class HatlyQuantityControl extends StatelessWidget {
  const HatlyQuantityControl({
    super.key,
    required this.valueLabel,
    required this.onDecrease,
    required this.onIncrease,
    required this.decreaseTooltip,
    required this.increaseTooltip,
    this.onValueTap,
    this.valueTapTooltip,
  });

  /// When set, tapping the value itself lets the customer TYPE the amount (used for weights, where ten taps of "+" is slow).
  final VoidCallback? onValueTap;
  final String? valueTapTooltip;

  final String valueLabel;
  final VoidCallback? onDecrease;
  final VoidCallback? onIncrease;
  final String decreaseTooltip;
  final String increaseTooltip;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: p.surfaceSoft,
        borderRadius: BorderRadius.circular(HatlyRadius.circular),
      ),
      child: Padding(
        padding: const EdgeInsets.all(HatlySpacing.xs),
        // Always `[ − 1 + ]`, also in RTL: it reads like the number line, not like the page.
        child: Directionality(
          textDirection: TextDirection.ltr,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _RoundStep(
                  key: const Key('qty-decrease'),
                  icon: Icons.remove_rounded,
                  tooltip: decreaseTooltip,
                  onTap: onDecrease),
              // Flexible + scaleDown: a long value ("1.50 kg") shrinks slightly on a narrow screen with
              // very large text instead of overflowing.
              Flexible(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                      minWidth: 44, minHeight: HatlyTouch.minTarget),
                  child: Semantics(
                    liveRegion: true,
                    button: onValueTap != null,
                    label: valueLabel,
                    hint: valueTapTooltip,
                    onTap: onValueTap,
                    child: ExcludeSemantics(
                      child: InkWell(
                        key: const Key('qty-value'),
                        borderRadius: BorderRadius.circular(HatlyRadius.chip),
                        onTap: onValueTap,
                        child: Center(
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: HatlySpacing.sm),
                              child: LtrText(valueLabel,
                                  textAlign: TextAlign.center,
                                  style: context.type.body.copyWith(
                                      color: p.textPrimary,
                                      fontWeight: FontWeight.w800,
                                      decoration: onValueTap == null
                                          ? null
                                          : TextDecoration.underline,
                                      decorationStyle:
                                          TextDecorationStyle.dotted)),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              _RoundStep(
                  key: const Key('qty-increase'),
                  icon: Icons.add_rounded,
                  tooltip: increaseTooltip,
                  onTap: onIncrease),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoundStep extends StatelessWidget {
  const _RoundStep(
      {super.key,
      required this.icon,
      required this.tooltip,
      required this.onTap});

  final IconData icon;
  final String tooltip;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final enabled = onTap != null;
    return Semantics(
      button: true,
      enabled: enabled,
      label: tooltip,
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        color: enabled ? p.surface : Colors.transparent,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: HatlyTouch.minTarget,
            height: HatlyTouch.minTarget,
            child: Icon(icon,
                size: 22,
                color: enabled
                    ? p.textPrimary
                    : p.textMuted.withValues(alpha: 0.5)),
          ),
        ),
      ),
    );
  }
}
