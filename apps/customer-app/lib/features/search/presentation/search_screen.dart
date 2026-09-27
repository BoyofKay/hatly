import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_search_field.dart';
import '../../home/data/home_providers.dart';
import '../data/explore_logic.dart';
import '../data/search_controller.dart';
import 'widgets/explore_discovery.dart';
import 'widgets/explore_search_results.dart';

/// Explore — the marketplace discovery page AND global search, in one screen.
///
/// Search box empty → the calm discovery page (Shop by Category, Featured
/// categories, Featured vendors, Offers, New on Hatly). Two or more characters
/// → results across Categories (matched locally by name against the loaded
/// category list), and Vendors + Products (the existing backend `GET /search`,
/// unchanged: same 400 ms debounce, same 2-character minimum, same coordinates).
///
/// The same screen serves two entry points:
///  * the bottom-navigation **Explore tab** — `autofocus: false`, so browsing
///    never pops a keyboard;
///  * the pushed **`/search` route** (Home's search bar) — `autofocus: true`
///    (the default), with a back button because it sits on top of the shell.
///
/// Customer-facing vendor ratings are an APPROVED part of the design; the
/// previous "ratings are prohibited" note that used to live here no longer
/// applies. Ratings shown come from the real `ratingAverage` / `ratingCount`
/// the vendor listing and search endpoints already return.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key, this.autofocus = true});

  final bool autofocus;

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) =>
      ref.read(searchControllerProvider.notifier).onQueryChanged(value);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final state = ref.watch(searchControllerProvider);
    final canPop = Navigator.of(context).canPop();
    final searching = state.status != SearchStatus.idle;
    final matched = matchCategories(
        state.query, ref.watch(homeCategoriesProvider).valueOrNull ?? const []);
    // One typed character: keep browsing, with a quiet hint.
    final showMinLengthHint = !searching && state.query.trim().isNotEmpty;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsetsDirectional.only(
                  start: HatlySpacing.screenPadding,
                  end: HatlySpacing.screenPadding,
                  top: HatlySpacing.sm),
              child: Row(
                children: [
                  if (canPop) const BackButton(),
                  Expanded(
                    child: HatlySearchField(
                      controller: _controller,
                      hintText: l10n.exploreSearchHint,
                      clearTooltip: l10n.exploreSearchClear,
                      autofocus: widget.autofocus,
                      onChanged: _onChanged,
                    ),
                  ),
                ],
              ),
            ),
            if (showMinLengthHint)
              Padding(
                padding: const EdgeInsets.only(top: HatlySpacing.sm),
                child: Text(l10n.searchPromptMinLength,
                    style: context.type.caption.copyWith(color: p.textMuted)),
              ),
            Expanded(
              child: searching || matched.isNotEmpty
                  ? ExploreSearchResults(
                      state: state,
                      matchedCategories: matched,
                      onRetry: () =>
                          ref.read(searchControllerProvider.notifier).retry(),
                    )
                  : const ExploreDiscovery(),
            ),
          ],
        ),
      ),
    );
  }
}
