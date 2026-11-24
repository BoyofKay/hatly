import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_search_bar.dart';

/// Global search entry on Home. Hands off to the existing `/search` route
/// (which searches vendors and products); no search logic lives here.
class HomeSearchEntry extends StatelessWidget {
  const HomeSearchEntry({super.key, this.onTap});
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Padding(
      padding:
          const EdgeInsets.symmetric(horizontal: HatlySpacing.screenPadding),
      child: HatlySearchBar(
          hintText: l10n.homeSearchHint, onTap: onTap ?? () => context.push('/search')),
    );
  }
}
