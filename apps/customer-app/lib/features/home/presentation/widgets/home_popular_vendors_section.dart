import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_section_header.dart';
import '../../../vendors/domain/vendor.dart';
import '../../../vendors/presentation/widgets/vendor_cover_card.dart';

/// "Popular near you": a title with "عرض الكل ←" and full-width vendor cards.
class HomePopularVendorsSection extends StatelessWidget {
  const HomePopularVendorsSection(
      {super.key,
      required this.vendors,
      required this.onSeeAll,
      required this.onVendorTap});

  final List<Vendor> vendors;
  final VoidCallback onSeeAll;
  final ValueChanged<Vendor> onVendorTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (vendors.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        HatlySectionHeader(
            title: l10n.homeSectionPopularNearYou,
            seeAllLabel: l10n.seeAll,
            onSeeAll: onSeeAll),
        const SizedBox(height: HatlySpacing.sm),
        Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: HatlySpacing.screenPadding),
          child: Column(
            children: [
              for (var i = 0; i < vendors.length; i++) ...[
                if (i > 0) const SizedBox(height: HatlySpacing.md),
                VendorCoverCard(
                    vendor: vendors[i], onTap: () => onVendorTap(vendors[i])),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
