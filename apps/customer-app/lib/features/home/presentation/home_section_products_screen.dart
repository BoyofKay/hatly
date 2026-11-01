import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_badge.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../products/presentation/widgets/product_card.dart';
import '../data/home_providers.dart';
import '../domain/home_content.dart';
import 'widgets/home_promo_actions.dart';

/// The full list behind a Home section's "See all" — "Most ordered", "New" or "Offers". It shows exactly the products the
/// section's own definition accepts (`loadHomeSection`): never the generic search page, never a product that is only there
/// because a sort happened to put it first. Loading, empty and error states are explicit; tapping a product opens its details.
class HomeSectionProductsScreen extends ConsumerWidget {
  const HomeSectionProductsScreen({super.key, required this.kind});

  final HomeSectionKind kind;

  static String titleOf(AppLocalizations l10n, HomeSectionKind kind) {
    switch (kind) {
      case HomeSectionKind.mostOrdered:
        return l10n.homeSectionMostOrdered;
      case HomeSectionKind.newest:
        return l10n.homeSectionNew;
      case HomeSectionKind.offers:
        return l10n.homeSeeAllOffersTitle;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final async = ref.watch(homeSectionProductsProvider(kind));
    return Scaffold(
      appBar: AppBar(title: Text(titleOf(l10n, kind))),
      body: SafeArea(
        child: async.when(
          loading: () => const HatlyLoadingView(),
          error: (_, __) => HatlyStateView(
            icon: Icons.error_outline,
            title: l10n.somethingWentWrong,
            retryLabel: l10n.retry,
            onRetry: () => ref.invalidate(homeSectionProductsProvider(kind)),
          ),
          data: (entries) {
            if (entries.isEmpty) {
              return HatlyStateView(
                  key: const Key('home-section-empty'),
                  icon: Icons.inbox_outlined,
                  title: l10n.homeSeeAllEmpty);
            }
            return LayoutBuilder(builder: (context, constraints) {
              const gap = HatlySpacing.md;
              final columns = constraints.maxWidth >= 600 ? 3 : 2;
              final width = (constraints.maxWidth -
                      HatlySpacing.screenPadding * 2 -
                      gap * (columns - 1)) /
                  columns;
              return RefreshIndicator(
                onRefresh: () async {
                  ref.invalidate(homeSectionProductsProvider(kind));
                  await ref
                      .read(homeSectionProductsProvider(kind).future)
                      .catchError((_) => <HomeProductEntry>[]);
                },
                child: SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(HatlySpacing.screenPadding),
                  child: Wrap(
                    spacing: gap,
                    runSpacing: gap,
                    children: [
                      for (final entry in entries)
                        ProductCard(
                          key: Key('home-section-product-${entry.product.id}'),
                          product: entry.product,
                          width: width,
                          extraBadge: entry.tag == HomeProductTag.newItem
                              ? HatlyBadgeKind.newItem
                              : null,
                          elevated: false,
                          onTap: () =>
                              context.push(productRoute(entry.product.id)),
                        ),
                    ],
                  ),
                ),
              );
            });
          },
        ),
      ),
    );
  }
}

/// A "See all" link whose section is not one of the three known ones: the app's own not-found treatment, not a blank page.
class HomeSectionUnknown extends StatelessWidget {
  const HomeSectionUnknown({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(),
      body: HatlyStateView(
        icon: Icons.error_outline,
        title: l10n.routeNotFoundTitle,
        retryLabel: l10n.checkoutSuccessBackHome,
        onRetry: () => context.go('/'),
      ),
    );
  }
}
