import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/hatly_cta_button.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../data/cart_providers.dart';

/// What the mini-sheet says about the item that was just added. [totalMinor] is the client-side ESTIMATE the
/// product screen already showed (the authoritative price lives in the cart, summarised below it).
class AddedCartItem {
  const AddedCartItem({
    required this.name,
    this.imageUrl,
    required this.quantityLabel,
    required this.vendorName,
    required this.totalMinor,
  });

  final String name;
  final String? imageUrl;

  /// "×2" for pieces, "0.30 kg" for weighted.
  final String quantityLabel;
  final String? vendorName;
  final int totalMinor;
}

/// Lightweight post-add sheet: confirmation, what was added, the current cart summary, "عرض السلة" and
/// "متابعة التسوق". Deliberately NOT checkout — no payment, address, delivery breakdown or order placement.
///
/// [onViewCart] runs AFTER the sheet is dismissed; "continue shopping" just dismisses it.
Future<void> showCartMiniSheet(
  BuildContext context, {
  required AddedCartItem item,
  required VoidCallback onViewCart,
}) async {
  final p = context.palette;
  final wantsCart = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: p.surface,
    showDragHandle: true,
    shape: const RoundedRectangleBorder(
      borderRadius:
          BorderRadius.vertical(top: Radius.circular(HatlyRadius.promoBanner)),
    ),
    builder: (context) => _CartMiniSheet(item: item),
  );
  if (wantsCart == true) onViewCart();
}

class _CartMiniSheet extends ConsumerWidget {
  const _CartMiniSheet({required this.item});

  final AddedCartItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final cart = ref.watch(cartControllerProvider).valueOrNull;

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(HatlySpacing.screenPadding, 0,
          HatlySpacing.screenPadding, HatlySpacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            liveRegion: true,
            header: true,
            child: Row(
              children: [
                Icon(Icons.check_circle_rounded, color: p.success, size: 24),
                const SizedBox(width: HatlySpacing.sm),
                Expanded(
                  child: Text(l10n.addedToCartConfirmation,
                      style: context.type.title.copyWith(
                          color: p.textPrimary, fontWeight: FontWeight.w800)),
                ),
              ],
            ),
          ),
          const SizedBox(height: HatlySpacing.md),
          Row(
            children: [
              HatlySoftImage(
                url: item.imageUrl,
                width: 64,
                height: 64,
                placeholderIcon: Icons.shopping_basket_outlined,
              ),
              const SizedBox(width: HatlySpacing.ms),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: context.type.body.copyWith(
                            color: p.textPrimary, fontWeight: FontWeight.w700)),
                    if (item.vendorName != null)
                      Text(l10n.cartMiniFromVendor(item.vendorName!),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.type.small),
                    LtrText(item.quantityLabel, style: context.type.small),
                  ],
                ),
              ),
              const SizedBox(width: HatlySpacing.sm),
              LtrText(formatMinorUnits(item.totalMinor, context),
                  style: context.type.body.copyWith(
                      color: p.textPrimary, fontWeight: FontWeight.w800)),
            ],
          ),
          if (cart != null && !cart.isEmpty) ...[
            const SizedBox(height: HatlySpacing.md),
            Text(
              l10n.cartMiniSummary(l10n.cartSummaryItemCount(cart.itemCount),
                  formatMinorUnits(cart.subtotalMinor, context)),
              style: context.type.small,
            ),
          ],
          const SizedBox(height: HatlySpacing.lg),
          HatlyCtaButton(
            label: l10n.cartSummaryViewCart,
            onPressed: () => Navigator.of(context).pop(true),
          ),
          const SizedBox(height: HatlySpacing.sm),
          Center(
            child: TextButton(
              style: TextButton.styleFrom(
                minimumSize:
                    const Size(HatlyTouch.minTarget * 2, HatlyTouch.minTarget),
                foregroundColor: p.link,
              ),
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(l10n.cartMiniContinue,
                  style: context.type.body
                      .copyWith(color: p.link, fontWeight: FontWeight.w700)),
            ),
          ),
        ],
      ),
    );
  }
}
