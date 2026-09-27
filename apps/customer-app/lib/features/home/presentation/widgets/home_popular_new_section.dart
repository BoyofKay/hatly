import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../shared_widgets/hatly_badge.dart';
import '../../../../shared_widgets/hatly_section_header.dart';
import '../../../products/presentation/widgets/product_card.dart';
import '../../domain/home_content.dart';
import 'home_horizontal_row.dart';

/// "Popular & New": the same [ProductCard] the rest of the app will use, in a
/// horizontal ~2.5-visible row. Mixed popular/new content — not personalised.
class HomePopularNewSection extends StatelessWidget {
  const HomePopularNewSection(
      {super.key,
      required this.entries,
      required this.onSeeAll,
      required this.onProductTap,
      this.onQuickAdd});

  final List<HomeProductEntry> entries;
  final VoidCallback onSeeAll;
  final ValueChanged<HomeProductEntry> onProductTap;

  /// Floating "+" on each card (null = no quick add).
  final ValueChanged<HomeProductEntry>? onQuickAdd;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (entries.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        HatlySectionHeader(
            title: l10n.homeSectionPopularNew,
            seeAllLabel: l10n.seeAll,
            onSeeAll: onSeeAll),
        HomeHorizontalRow(
          itemCount: entries.length,
          itemBuilder: (context, i, width) => ProductCard(
            product: entries[i].product,
            width: width,
            // Quiet section: only "New" carries information a card can't
            // already show; "Popular" is what the section itself says.
            extraBadge: entries[i].tag == HomeProductTag.newItem
                ? HatlyBadgeKind.newItem
                : null,
            elevated: false,
            onTap: () => onProductTap(entries[i]),
            onQuickAdd:
                onQuickAdd == null ? null : () => onQuickAdd!(entries[i]),
          ),
        ),
      ],
    );
  }
}
