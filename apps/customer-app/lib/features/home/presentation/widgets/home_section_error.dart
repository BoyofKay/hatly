import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_section_header.dart';
import '../../../../shared_widgets/hatly_surface.dart';
import '../../../../shared_widgets/skeleton_box.dart';
import '../../domain/home_content.dart';

/// One Home product row the server could not produce this time: the row's own title with a retry. The other rows are unaffected, and
/// while the retry is in flight this row (only) shows a skeleton of its own height.
class HomeSectionError extends StatelessWidget {
  const HomeSectionError({
    super.key,
    required this.kind,
    required this.title,
    required this.onRetry,
    this.retrying = false,
  });

  final HomeSectionKind kind;
  final String title;
  final VoidCallback onRetry;
  final bool retrying;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return Column(
      key: Key('home-section-error-${kind.name}'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        HatlySectionHeader(title: title),
        if (retrying)
          const Padding(
            padding:
                EdgeInsets.symmetric(horizontal: HatlySpacing.screenPadding),
            child: SkeletonBox(
                width: double.infinity,
                height: 120,
                borderRadius: HatlyRadius.card),
          )
        else
          Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: HatlySpacing.screenPadding),
            child: HatlySurface(
              child: Row(
                children: [
                  Icon(Icons.wifi_off_rounded, color: p.textMuted),
                  const SizedBox(width: HatlySpacing.ms),
                  Expanded(
                      child: Text(l10n.somethingWentWrong,
                          style: context.type.body)),
                  TextButton(
                    key: Key('home-section-retry-${kind.name}'),
                    onPressed: onRetry,
                    child: Text(l10n.retry),
                  ),
                ],
              ),
            ),
          ),
        const SizedBox(height: HatlySpacing.xl),
      ],
    );
  }
}
