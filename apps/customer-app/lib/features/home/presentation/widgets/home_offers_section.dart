import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../shared_widgets/hatly_section_header.dart';
import '../../domain/home_content.dart';
import 'home_horizontal_row.dart';
import 'home_promo_actions.dart';
import 'offer_card.dart';

/// Mixed Offers: product / vendor / free-delivery / bundle / flash cards in one
/// horizontal row, ~2.5 visible. No offer engine — it renders [HomeOffer]s.
class HomeOffersSection extends StatelessWidget {
  const HomeOffersSection(
      {super.key,
      required this.offers,
      this.onSeeAll,
      required this.onOfferTap,
      this.onQuickAdd});

  final List<HomeOffer> offers;

  /// Null = no "عرض الكل ←" (used where there is no meaningful destination).
  final VoidCallback? onSeeAll;
  final ValueChanged<HomeOffer> onOfferTap;

  /// Floating "+" for offers that are a real product (null = none).
  final ValueChanged<HomeOffer>? onQuickAdd;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (offers.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        HatlySectionHeader(
            title: l10n.homeSectionOffers,
            seeAllLabel: onSeeAll == null ? null : l10n.seeAll,
            onSeeAll: onSeeAll),
        HomeHorizontalRow(
          itemCount: offers.length,
          itemBuilder: (context, i, width) => OfferCard(
              offer: offers[i],
              width: width,
              onTap: () => onOfferTap(offers[i]),
              onQuickAdd: onQuickAdd != null && offerIsQuickAddable(offers[i])
                  ? () => onQuickAdd!(offers[i])
                  : null),
        ),
      ],
    );
  }
}
