import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../domain/cart.dart';

/// One vendor's part of the cart as a collapsible section: a header (vendor name, item count, the vendor
/// subtotal exactly as the API returned it, the backend's own subtotal-discount flag, and an expand/collapse
/// affordance) above the item rows in [children]. The expanded state is owned by the caller (screen-local);
/// nothing is persisted.
class CartVendorSection extends StatelessWidget {
  const CartVendorSection({
    super.key,
    required this.group,
    required this.expanded,
    required this.onToggle,
    required this.children,
  });

  final CartGroup group;
  final bool expanded;
  final VoidCallback onToggle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final name = group.vendorName ?? group.adHocPlaceName ?? l10n.cart;
    final subtotal = group.subtotalMinor;
    final count = group.items.length;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(HatlyRadius.card),
        boxShadow: HatlyShadows.soft(p),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            button: true,
            expanded: expanded,
            label: [
              expanded
                  ? l10n.cartSectionCollapse(name)
                  : l10n.cartSectionExpand(name),
              l10n.cartSummaryItemCount(count),
              if (subtotal != null) formatMinorUnits(subtotal, context),
              if (group.hasSubtotalDiscountOffer)
                l10n.cartSubtotalDiscountBanner,
            ].join('، '),
            onTap: onToggle,
            excludeSemantics: true,
            child: InkWell(
              borderRadius: BorderRadius.circular(HatlyRadius.card),
              onTap: onToggle,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 64),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: HatlySpacing.md, vertical: HatlySpacing.ms),
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                            color: p.accentSoft,
                            borderRadius:
                                BorderRadius.circular(HatlyRadius.button)),
                        child: Icon(Icons.storefront_outlined,
                            color: p.accent, size: 22),
                      ),
                      const SizedBox(width: HatlySpacing.ms),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Two lines: at large text sizes the vendor's identity must stay readable.
                            Text(name,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: context.type.title.copyWith(
                                    color: p.textPrimary,
                                    fontWeight: FontWeight.w800)),
                            Text(l10n.cartSummaryItemCount(count),
                                style: context.type.caption),
                          ],
                        ),
                      ),
                      const SizedBox(width: HatlySpacing.sm),
                      // The API's own vendor subtotal — never recomputed here. Null (custom request not
                      // priced yet) shows nothing rather than a fake 0.
                      if (subtotal != null)
                        Flexible(
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            child: LtrText(formatMinorUnits(subtotal, context),
                                style: context.type.body.copyWith(
                                    color: p.textPrimary,
                                    fontWeight: FontWeight.w800)),
                          ),
                        ),
                      const SizedBox(width: HatlySpacing.xs),
                      AnimatedRotation(
                        turns: expanded ? 0.5 : 0,
                        duration: const Duration(milliseconds: 180),
                        child: Icon(Icons.keyboard_arrow_down_rounded,
                            color: p.textMuted, size: 26),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 180),
            alignment: AlignmentDirectional.topStart,
            child: expanded
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(
                        HatlySpacing.md, 0, HatlySpacing.md, HatlySpacing.sm),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Divider(height: 1, color: p.border),
                        if (group.hasSubtotalDiscountOffer)
                          Padding(
                            padding: const EdgeInsets.only(
                                top: HatlySpacing.ms, bottom: HatlySpacing.xs),
                            child: Align(
                              alignment: AlignmentDirectional.centerStart,
                              // Not a HatlyBadge: this sentence must wrap at large text sizes instead of
                              // being cut to one line.
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  color: p.accentSoft,
                                  borderRadius:
                                      BorderRadius.circular(HatlyRadius.badge),
                                ),
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: HatlySpacing.sm, vertical: 4),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Padding(
                                        padding: const EdgeInsets.only(top: 1),
                                        child: Icon(Icons.local_offer_outlined,
                                            size: 14, color: p.link),
                                      ),
                                      const SizedBox(width: HatlySpacing.xs),
                                      Flexible(
                                        child: Text(
                                            l10n.cartSubtotalDiscountBanner,
                                            style: context.type.caption
                                                .copyWith(
                                                    color: p.link,
                                                    fontWeight:
                                                        FontWeight.w700)),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ),
                        for (var i = 0; i < children.length; i++) ...[
                          if (i > 0) Divider(height: 1, color: p.border),
                          children[i],
                        ],
                      ],
                    ),
                  )
                : const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }
}
