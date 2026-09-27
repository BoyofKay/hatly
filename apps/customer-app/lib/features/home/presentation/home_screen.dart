import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/cart_summary_bar.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/skeleton_box.dart';
import '../../auth/presentation/widgets/phone_verification_banner.dart';
import '../data/home_providers.dart';
import 'widgets/home_category_section.dart';
import 'widgets/home_location_bar.dart';
import 'widgets/home_offers_section.dart';
import 'widgets/home_popular_new_section.dart';
import 'widgets/home_promo_actions.dart';
import 'widgets/home_search_entry.dart';
import 'widgets/promo_carousel.dart';

/// Customer Home — approved structure, top to bottom:
/// Location → Global Search → Rotating Promo Carousel → Shop by Category (3-column
/// grid) → Offers → Popular & New. (The floating bottom navigation is owned by
/// the shell.) Vendor discovery lives in Explore and the category listings;
/// Home deliberately has no vendor section.
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
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(homeCategoriesProvider);
            ref.invalidate(homeSnapshotProvider);
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
              // 1. Location
              const HomeLocationBar(),
              const PhoneVerificationBanner(),
              const SizedBox(height: HatlySpacing.sm),
              // 2. Global search
              const HomeSearchEntry(),
              const SizedBox(height: HatlySpacing.md),
              ...snapshotAsync.when(
                loading: () => const [_HomeSkeleton()],
                error: (error, stackTrace) => [
                  SizedBox(
                    height: 260,
                    child: HatlyStateView(
                      icon: Icons.wifi_off_rounded,
                      title: l10n.somethingWentWrong,
                      retryLabel: l10n.retry,
                      onRetry: () {
                        ref.invalidate(homeCategoriesProvider);
                        ref.invalidate(homeSnapshotProvider);
                      },
                    ),
                  ),
                ],
                data: (snapshot) => [
                  // 3. Rotating promo carousel
                  if (snapshot.promos.isNotEmpty) ...[
                    PromoCarousel(
                      promos: snapshot.promos,
                      onAction: (promo) =>
                          handlePromoAction(context, ref, promo),
                    ),
                    const SizedBox(height: _sectionGap),
                  ],
                  // 4. Shop by category
                  const HomeCategorySection(),
                  const SizedBox(height: _sectionGap),
                  // 5. Offers  (there is no offers list screen yet → Explore/search)
                  HomeOffersSection(
                    offers: snapshot.offers,
                    onSeeAll: () => context.push('/search'),
                    onOfferTap: (offer) => context.push(offerRoute(offer)),
                    onQuickAdd: (offer) =>
                        handleQuickAdd(context, ref, offer.targetId!),
                  ),
                  if (snapshot.offers.isNotEmpty)
                    const SizedBox(height: _sectionGap),
                  // 6. Popular & new
                  HomePopularNewSection(
                    entries: snapshot.productEntries,
                    onSeeAll: () => context.push('/search'),
                    onProductTap: (entry) =>
                        context.push(productRoute(entry.product.id)),
                    onQuickAdd: (entry) =>
                        handleQuickAdd(context, ref, entry.product.id),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HomeSkeleton extends StatelessWidget {
  const _HomeSkeleton();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(horizontal: HatlySpacing.screenPadding),
      child: Column(
        children: [
          SkeletonBox(
              width: double.infinity,
              height: 176,
              borderRadius: HatlyRadius.promoBanner),
          SizedBox(height: HatlySpacing.lg),
          Row(
            children: [
              Expanded(
                  child: SkeletonBox(
                      width: double.infinity,
                      height: 96,
                      borderRadius: HatlyRadius.card)),
              SizedBox(width: HatlySpacing.ms),
              Expanded(
                  child: SkeletonBox(
                      width: double.infinity,
                      height: 96,
                      borderRadius: HatlyRadius.card)),
              SizedBox(width: HatlySpacing.ms),
              Expanded(
                  child: SkeletonBox(
                      width: double.infinity,
                      height: 96,
                      borderRadius: HatlyRadius.card)),
            ],
          ),
          SizedBox(height: HatlySpacing.lg),
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
