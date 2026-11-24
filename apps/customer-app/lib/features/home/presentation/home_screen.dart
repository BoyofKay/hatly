import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/cart_summary_bar.dart';
import '../../../shared_widgets/home_hero_artwork.dart';
import '../../../shared_widgets/hatly_section_header.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/skeleton_box.dart';
import '../../auth/presentation/widgets/phone_verification_banner.dart';
import '../../notifications/data/notifications_providers.dart';
import '../../search/presentation/widgets/explore_discovery.dart';
import '../data/home_banners_providers.dart';
import '../data/home_providers.dart';
import '../domain/home_content.dart';
import 'widgets/hatly_service_entry_card.dart';
import 'widgets/home_banner_section.dart';
import 'widgets/home_category_section.dart';
import 'widgets/home_offers_section.dart';
import 'widgets/home_popular_new_section.dart';
import 'widgets/home_promo_actions.dart';
import 'widgets/home_search_entry.dart';
import 'widgets/home_section_error.dart';

/// Customer Home — approved structure, top to bottom:
/// Location → Global Search → Rotating Promo Carousel → Shop by Category (3-column
/// grid) → Hatly Service entry → Featured stores → Offers → Popular & New. (The
/// floating bottom navigation is owned by the shell.)
///
/// Featured stores (added 2026-11-02, owner decision, following the reference
/// board) is the same real, ranked vendor row Explore shows — the snapshot's
/// `popularVendors` — with no "see all" (there is no all-vendors listing to
/// open). It disappears when there are no vendors.
///
/// The Hatly Service entry is not a vendor entry point at all, but the
/// standalone, not-vendor-scoped Hatly Service request (see
/// `hatly_service_entry_card.dart`'s own doc comment for why it is its own
/// section rather than a tile inside "Shop by Category").
///
/// Everything below Search is data from the EXISTING repositories composed in
/// `home_providers.dart`; nothing here talks to the network or owns business
/// rules, and sections without data disappear instead of showing placeholders.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  static const double _sectionGap = HatlySpacing.xl;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final snapshotAsync = ref.watch(homeSnapshotProvider);

    return Scaffold(
      bottomNavigationBar: const CartSummaryBar(),
      body: SafeArea(
        child: Column(children: [
          // A continuous Home header: location and search stay in place while the feed scrolls.
          if (!HomePinnedSearchScope.of(context))
            const Padding(
              padding: EdgeInsets.only(top: 6, bottom: 8),
              child: HomeSearchEntry(),
            ),
          Expanded(child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(homeCategoriesProvider);
            ref.invalidate(homeBannersProvider);
            ref.invalidate(homeSnapshotProvider);
            ref.invalidate(unreadNotificationsCountProvider);
            await ref
                .read(homeSnapshotProvider.future)
                .catchError((_) => const HomeSnapshot(
                      popularVendors: [],
                      productEntries: [],
                      offers: [],
                      promos: [],
                    ));
          },
          child: ListView(
            padding: const EdgeInsets.only(bottom: HatlySpacing.lg),
            children: [
              const PhoneVerificationBanner(),
              // 3. Rotating promo carousel — INDEPENDENT of the product rows below: its own request starts with the screen, and a slow
              // or failed product load can never hold it back. Admin banners when there are any, otherwise the offer-derived promos
              // (available once the snapshot is); nothing → no space.
              HomeBannerSection(
                fallbackPromos: snapshotAsync.valueOrNull?.promos ?? const [],
                onPromoAction: (promo) =>
                    handlePromoAction(context, ref, promo),
              ),
              // 4. Shop by category — needs only the sectors request, so it appears as soon as that answers.
              const HomeCategorySection(),
              const SizedBox(height: _sectionGap),
              // Hatly Service entry point — additive, not part of the category grid (see hatly_service_entry_card.dart).
              const HatlyServiceEntryCard(),
              const SizedBox(height: _sectionGap),
              // Everything below is composed from the vendor/product listings (several sequential requests): it loads on its own, shows
              // its own skeleton while loading, and a failure there is a retry card — never a blank or broken Home above it.
              ...snapshotAsync.when(
                loading: () => const [_HomeSectionsSkeleton()],
                error: (error, stackTrace) => [
                  // A failed SECTORS call also fails the snapshot; the category section already shows that error with its retry.
                  if (!ref.watch(homeCategoriesProvider).hasError)
                    SizedBox(
                      height: 200,
                      child: HatlyStateView(
                        icon: Icons.wifi_off_rounded,
                        title: l10n.somethingWentWrong,
                        retryLabel: l10n.retry,
                        onRetry: () => ref.invalidate(homeSnapshotProvider),
                      ),
                    ),
                ],
                data: (snapshot) => [
                  // Featured stores — the real ranked vendors (same row as Explore).
                  if (snapshot.popularVendors.isNotEmpty) ...[
                    KeyedSubtree(
                      key: const Key('home-featured-stores'),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          HatlySectionHeader(
                              title: l10n.exploreSectionFeaturedVendors),
                          const SizedBox(height: HatlySpacing.xs),
                          VendorRow(
                              vendors: snapshot.popularVendors,
                              onTap: (v) => context.push(vendorRoute(v.id))),
                        ],
                      ),
                    ),
                    const SizedBox(height: _sectionGap),
                  ],
                  // 5. Offers — products with a valid offer. "See all" opens the full list of the SAME definition.
                  if (snapshot.failedSections.contains(HomeSectionKind.offers))
                    HomeSectionError(
                      kind: HomeSectionKind.offers,
                      title: l10n.homeSectionOffers,
                      retrying: snapshotAsync.isRefreshing,
                      onRetry: () => ref.invalidate(homeSnapshotProvider),
                    )
                  else
                    HomeOffersSection(
                      offers: snapshot.offers,
                      onSeeAll: () => context
                          .push(homeSectionRoute(HomeSectionKind.offers)),
                      onOfferTap: (offer) => context.push(offerRoute(offer)),
                      onQuickAdd: (offer) =>
                          handleQuickAdd(context, ref, offer.targetId!),
                    ),
                  if (snapshot.offers.isNotEmpty &&
                      !snapshot.failedSections.contains(HomeSectionKind.offers))
                    const SizedBox(height: _sectionGap),
                  // 6. Most ordered — only products that have really been delivered (never an arbitrary product).
                  ..._productSection(
                    context,
                    ref,
                    title: l10n.homeSectionMostOrdered,
                    kind: HomeSectionKind.mostOrdered,
                    failed: snapshot.failedSections
                        .contains(HomeSectionKind.mostOrdered),
                    retrying: snapshotAsync.isRefreshing,
                    entries: [
                      for (final e in snapshot.productEntries)
                        if (e.tag == HomeProductTag.popular) e
                    ],
                  ),
                  // 7. New — products created in the last 30 days.
                  ..._productSection(
                    context,
                    ref,
                    title: l10n.homeSectionNew,
                    kind: HomeSectionKind.newest,
                    failed: snapshot.failedSections
                        .contains(HomeSectionKind.newest),
                    retrying: snapshotAsync.isRefreshing,
                    entries: [
                      for (final e in snapshot.productEntries)
                        if (e.tag == HomeProductTag.newItem) e
                    ],
                  ),
                ],
              ),
            ],
          ))),
        ]),
      ),
    );
  }
}

/// One product row plus its gap, or nothing at all when the section has no products (sections without data disappear).
List<Widget> _productSection(
  BuildContext context,
  WidgetRef ref, {
  required String title,
  required HomeSectionKind kind,
  required List<HomeProductEntry> entries,
  bool failed = false,
  bool retrying = false,
}) {
  // A section the server could not produce is its own retry card; one that is simply empty disappears (the other rows are unaffected).
  if (failed) {
    return [
      HomeSectionError(
        kind: kind,
        title: title,
        retrying: retrying,
        onRetry: () => ref.invalidate(homeSnapshotProvider),
      ),
    ];
  }
  if (entries.isEmpty) return const [];
  return [
    HomePopularNewSection(
      title: title,
      entries: entries,
      onSeeAll: () => context.push(homeSectionRoute(kind)),
      onProductTap: (entry) => context.push(productRoute(entry.product.id)),
      onQuickAdd: (entry) => handleQuickAdd(context, ref, entry.product.id),
    ),
    const SizedBox(height: HomeScreen._sectionGap),
  ];
}

/// Placeholder for the product rows only (banners and categories have their own skeletons).
class _HomeSectionsSkeleton extends StatelessWidget {
  const _HomeSectionsSkeleton();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(horizontal: HatlySpacing.screenPadding),
      child: Column(
        children: [
          SkeletonBox(
              width: double.infinity,
              height: 210,
              borderRadius: HatlyRadius.card),
          SizedBox(height: HatlySpacing.md),
          SkeletonBox(
              width: double.infinity,
              height: 210,
              borderRadius: HatlyRadius.card),
        ],
      ),
    );
  }
}
