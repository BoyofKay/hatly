import 'package:flutter/material.dart';
import '../core/localization/l10n/app_localizations.dart';
import '../core/theme/hatly_theme.dart';
import 'ltr_text.dart';

/// Compact "★ 4.6 (128)" line for a vendor's real backend rating. Renders
/// nothing when the vendor has no ratings yet — never a fake 0.0 or 5 stars.
class HatlyRatingInline extends StatelessWidget {
  const HatlyRatingInline(
      {super.key, required this.average, required this.count});

  final double average;
  final int count;

  @override
  Widget build(BuildContext context) {
    if (count <= 0) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final text = average.toStringAsFixed(1);
    return Semantics(
      label: l10n.vendorRatingSemantics(text),
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.star_rounded, size: 18, color: p.warning),
          const SizedBox(width: 2),
          LtrText(text,
              style: context.type.small
                  .copyWith(color: p.textPrimary, fontWeight: FontWeight.w700)),
          const SizedBox(width: 4),
          Flexible(
            child: LtrText('($count)',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: context.type.caption),
          ),
        ],
      ),
    );
  }
}
