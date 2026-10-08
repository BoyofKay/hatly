import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/localization/l10n/app_localizations.dart';
import '../core/theme/hatly_theme.dart';
import '../core/utils/money_formatter.dart';
import '../features/cart/data/cart_providers.dart';

/// UI/UX-1 Home + Discovery. Contextual cart visibility — CONFIRMED
/// never a bottom-nav tab, never a new cart flow. Appears ONLY when
/// the existing `cartControllerProvider`'s real `Cart` state has
/// items (`!cart.isEmpty`), disappears automatically otherwise (empty
/// cart, loading, or error all render nothing — never a fake count).
/// Shows only `Cart.itemCount`/`Cart.subtotalMinor`, both already
/// real, already-aggregated-across-vendor-groups fields on the
/// existing model — nothing invented, no delivery fee/discount/final
/// total fabricated. Multi-vendor complexity stays fully inside the
/// Cart screen; this bar never mentions "segment"/"group".
class CartSummaryBar extends ConsumerWidget {
  const CartSummaryBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cartAsync = ref.watch(cartControllerProvider);
    final l10n = AppLocalizations.of(context);

    return cartAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (cart) {
        if (cart.isEmpty) return const SizedBox.shrink();

        return SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
                HatlySpacing.md, 0, HatlySpacing.md, HatlySpacing.sm),
            child: Material(
              color: HatlyColors.primaryOrange,
              borderRadius: BorderRadius.circular(HatlyRadius.card),
              child: InkWell(
                borderRadius: BorderRadius.circular(HatlyRadius.card),
                onTap: () => context.push('/cart'),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: HatlySpacing.md, vertical: HatlySpacing.ms),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: HatlySpacing.sm, vertical: 2),
                        decoration: BoxDecoration(
                          color: HatlyColors.surfaceWhite.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(HatlyRadius.chip),
                        ),
                        child: Text(
                          l10n.cartSummaryItemCount(cart.itemCount),
                          style: Theme.of(context)
                              .textTheme
                              .labelLarge
                              ?.copyWith(color: HatlyColors.surfaceWhite),
                        ),
                      ),
                      const SizedBox(width: HatlySpacing.sm),
                      Expanded(
                        child: Text(
                          // A cart holding a Hatly Service request with a pending price has nothing numeric to show: its subtotal is
                          // 0 only because nothing is priced yet, and a "0" would read as free. Say the real state instead.
                          cart.hasUnpricedItems
                              ? l10n.hatlyServicePricePending
                              : formatMinorUnits(cart.subtotalMinor, context),
                          key: const Key('cart-summary-total'),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context)
                              .textTheme
                              .titleMedium
                              ?.copyWith(color: HatlyColors.surfaceWhite),
                        ),
                      ),
                      Text(
                        l10n.cartSummaryViewCart,
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                            color: HatlyColors.surfaceWhite,
                            fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(width: HatlySpacing.xs),
                      const Icon(Icons.arrow_forward,
                          color: HatlyColors.surfaceWhite, size: 18),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
