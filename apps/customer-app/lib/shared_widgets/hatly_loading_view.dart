import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// UI/UX-0 Design System. A full-screen/inline loading indicator for
/// a screen's first load — distinct from the existing [SkeletonBox]
/// (a per-item placeholder shape used while list content streams in)
/// and from [HatlyStateView] (which covers the empty/error outcomes
/// once loading finishes, not the loading state itself). Replaces the
/// plain "Loading..." text duplicated across screens pre-UI/UX-0
/// (e.g. custom_request_action.dart, cart_screen.dart).
class HatlyLoadingView extends StatelessWidget {
  const HatlyLoadingView({super.key, this.inline = false});

  final bool inline;

  @override
  Widget build(BuildContext context) {
    const indicator =
        CircularProgressIndicator(color: HatlyColors.primaryOrange);
    if (inline)
      return const Center(
          child: SizedBox(width: 24, height: 24, child: indicator));
    return const Center(child: indicator);
  }
}
