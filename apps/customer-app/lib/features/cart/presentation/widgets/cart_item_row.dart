import 'package:flutter/material.dart';
import '../../../../shared_widgets/weight_selector.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/hatly_badge.dart';
import '../../../../shared_widgets/hatly_quantity_control.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../../../core/media/media_url.dart';
import '../../../../shared_widgets/voice_note/voice_note_field.dart';
import '../../domain/cart.dart';

/// One cart line, built only from the real cart-item fields. Visual priority: product image, name, the
/// selected options (no space is reserved when there are none), the quantity, then the price.
///
/// Quantity keeps the existing rules: pieces use `onQuantityChanged`; weighted items step in 100g through
/// `onWeightChanged` (never below 100g, and capped by known stock for a TRACKED item); a custom-request /
/// ad-hoc line shows its quantity as text only. While a mutation for this line is running, [busy] disables
/// its controls (no duplicate taps) and shows a small spinner — the rest of the cart stays usable.
///
/// "تعديل" only navigates (the caller opens Product Details): the backend cannot change options on an
/// existing line, so nothing here pretends to edit in place.
class CartItemRow extends StatelessWidget {
  const CartItemRow({
    super.key,
    required this.item,
    required this.onQuantityChanged,
    required this.onWeightChanged,
    required this.onRemove,
    this.onEdit,
    this.busy = false,
    this.isCustomRequest = false,
    this.isHatlyService = false,
    this.isDeliveryOnly = false,
  });

  final CartItem item;
  final ValueChanged<int> onQuantityChanged;
  final ValueChanged<int> onWeightChanged;
  final VoidCallback onRemove;

  /// Null when the line has no product to open (custom / ad-hoc requests).
  final VoidCallback? onEdit;
  final bool busy;
  final bool isCustomRequest;

  /// The line belongs to a Hatly Service request: its pending price says when it will be confirmed.
  final bool isHatlyService;

  /// Wasally: no item price exists (delivery fee only) — shown as that, not as "price pending".
  final bool isDeliveryOnly;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic && item.productNameAr != null
        ? item.productNameAr!
        : (item.productName ??
            ((item.freeTextDescription?.isNotEmpty ?? false)
                ? item.freeTextDescription!
                : (item.voiceNoteUrl != null
                    ? AppLocalizations.of(context).voiceNoteAttached
                    : '')));
    final options = item.selectedOptionValues
        .map((v) => isArabic && v.nameAr != null ? v.nameAr! : v.name)
        .join('، ');
    final unit = item.isWeighted ? ' /kg' : '';

    return Opacity(
      opacity: item.isAvailable ? 1 : 0.6,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: HatlySpacing.ms),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Decorative: the name next to it already says what it is.
                ExcludeSemantics(
                  child: HatlySoftImage(
                    url: item.productImageUrl,
                    width: 72,
                    height: 72,
                    placeholderIcon: Icons.shopping_basket_outlined,
                  ),
                ),
                const SizedBox(width: HatlySpacing.ms),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: context.type.body.copyWith(
                              color: p.textPrimary,
                              fontWeight: FontWeight.w700)),
                      if (options.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(options, style: context.type.small),
                        ),
                      if (isCustomRequest ||
                          item.hasFlashSale ||
                          !item.isAvailable)
                        Padding(
                          padding: const EdgeInsets.only(top: HatlySpacing.xs),
                          child: Wrap(
                            spacing: HatlySpacing.sm,
                            runSpacing: HatlySpacing.xs,
                            children: [
                              if (isCustomRequest)
                                HatlyBadge(
                                    kind: HatlyBadgeKind.bundle,
                                    label: l10n.cartCustomRequestBadge),
                              if (item.hasFlashSale)
                                HatlyBadge(
                                    kind: HatlyBadgeKind.flashSale,
                                    label: l10n.badgeFlashSale),
                              if (!item.isAvailable)
                                HatlyBadge(
                                    kind: HatlyBadgeKind.unavailable,
                                    label: l10n.cartItemNoLongerAvailable),
                            ],
                          ),
                        ),
                      if (isCustomRequest && resolveMediaUrl(item.voiceNoteUrl) != null)
                        VoiceNotePlayButton(url: resolveMediaUrl(item.voiceNoteUrl)!),
                      if (isCustomRequest && item.imageUrls.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: HatlySpacing.sm),
                          child: Wrap(
                            spacing: HatlySpacing.sm,
                            children: [
                              for (final url in item.imageUrls)
                                ExcludeSemantics(
                                  child: HatlySoftImage(
                                      url: url,
                                      width: 40,
                                      height: 40,
                                      radius: HatlyRadius.chip),
                                ),
                            ],
                          ),
                        ),
                      const SizedBox(height: HatlySpacing.xs),
                      _Price(
                          item: item,
                          unit: unit,
                          isHatlyService: isHatlyService,
                          isDeliveryOnly: isDeliveryOnly),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: HatlySpacing.sm),
            // Keep actions on one line when they fit; wrap as intact clusters
            // on narrow phones / large Arabic text instead of shrinking the
            // quantity control's 44px touch targets. No mutation rules change.
            LayoutBuilder(
              builder: (context, constraints) => SizedBox(width: constraints.maxWidth, child: Wrap(
                alignment: WrapAlignment.spaceBetween,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: HatlySpacing.xs,
                runSpacing: HatlySpacing.xs,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // The bounded width keeps +/- buttons touch-safe even
                      // when Edit/Remove are particularly wide in translation.
                      SizedBox(
                        width: item.isAdHoc ? 60 : 164,
                        child: _quantity(context, l10n, p),
                      ),
                      if (busy) ...[
                        const SizedBox(width: 4),
                        Semantics(
                          label: l10n.cartItemUpdating,
                          liveRegion: true,
                          child: SizedBox(
                            width: 16, height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2, color: p.accent),
                          ),
                        ),
                      ],
                    ],
                  ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (onEdit != null)
                        TextButton(
                          onPressed: busy ? null : onEdit,
                          style: TextButton.styleFrom(
                            minimumSize: const Size(44, 44),
                            padding: const EdgeInsets.symmetric(horizontal: 5),
                            foregroundColor: p.link,
                          ),
                          child: Text(l10n.cartEditItem,
                            style: context.type.small.copyWith(
                              color: p.link, fontWeight: FontWeight.w700)),
                        ),
                      Semantics(
                        button: true,
                        enabled: !busy,
                        label: l10n.cartRemoveItem,
                        excludeSemantics: true,
                        onTap: busy ? null : onRemove,
                        child: IconButton(
                          onPressed: busy ? null : onRemove,
                          tooltip: l10n.cartRemoveItem,
                          constraints: const BoxConstraints(
                            minWidth: 44, minHeight: 44),
                          icon: Icon(Icons.delete_outline_rounded,
                            color: busy ? p.textMuted : p.textPrimary,
                            size: 22),
                        ),
                      ),
                    ],
                  ),
                ],
              )),
            ),
          ],
        ),
      ),
    );
  }

  Widget _quantity(
      BuildContext context, AppLocalizations l10n, HatlyPalette p) {
    if (item.isAdHoc) {
      return LtrText('×${item.quantity}', style: context.type.small);
    }
    if (item.isWeighted) {
      final grams = item.requestedWeightGrams ?? 0;
      final maxGrams = item.isTracked ? item.availableQuantity : null;
      final atMax = maxGrams != null && grams >= maxGrams;
      return HatlyQuantityControl(
        valueLabel: weightShortLabel(grams, l10n),
        decreaseTooltip: l10n.quantityDecrease,
        increaseTooltip: l10n.quantityIncrease,
        valueTapTooltip: l10n.weightEntryTooltip,
        // Type the weight (e.g. 1 kg) instead of tapping "+" ten times. The same bounds as the product screen; the server re-validates.
        onValueTap: busy
            ? null
            : () async {
                final typed = await showWeightEntryDialog(context,
                    initialGrams: grams, maxGrams: maxGrams);
                if (typed != null && typed != grams) onWeightChanged(typed);
              },
        // Quarter-kilo steps that snap to quarters (0.3 kg → + ½ kg, − ¼ kg); never above known stock.
        onDecrease: busy || grams <= kWeightStepGrams
            ? null
            : () => onWeightChanged(weightStepDown(grams)),
        onIncrease: busy || atMax
            ? null
            : () => onWeightChanged(maxGrams != null && weightStepUp(grams) > maxGrams ? maxGrams : weightStepUp(grams)),
      );
    }
    final maxQuantity =
        item.isTracked ? (item.availableQuantity ?? 0).clamp(0, 50) : 50;
    return HatlyQuantityControl(
      valueLabel: '${item.quantity}',
      decreaseTooltip: l10n.quantityDecrease,
      increaseTooltip: l10n.quantityIncrease,
      onDecrease: busy || item.quantity <= 1
          ? null
          : () => onQuantityChanged(item.quantity - 1),
      onIncrease: busy || item.quantity >= maxQuantity
          ? null
          : () => onQuantityChanged(item.quantity + 1),
    );
  }
}

class _Price extends StatelessWidget {
  const _Price(
      {required this.item,
      required this.unit,
      this.isHatlyService = false,
      this.isDeliveryOnly = false});

  final CartItem item;
  final String unit;
  final bool isHatlyService;
  final bool isDeliveryOnly;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final line = item.lineTotalMinor;

    if (isDeliveryOnly) {
      return Text(l10n.hatlyServiceDeliveryOnly,
          key: const Key('cart-item-delivery-only'), style: context.type.small);
    }
    if (line == null) {
      // The backend uses null for "not priced yet" — never shown as 0 or blank.
      return Text(
          isHatlyService
              ? l10n.hatlyServicePricePending
              : l10n.cartCustomRequestPricePending,
          key: const Key('cart-item-price-pending'),
          style: context.type.small);
    }
    if (item.hasOfferPreview) {
      return Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: HatlySpacing.sm,
        children: [
          LtrText(formatMinorUnits(item.payableLineTotalMinor ?? line, context),
              style: context.type.body
                  .copyWith(color: p.success, fontWeight: FontWeight.w800)),
          LtrText(formatMinorUnits(line, context),
              style: context.type.caption
                  .copyWith(decoration: TextDecoration.lineThrough)),
        ],
      );
    }
    return LtrText(formatMinorUnits(line, context),
        style: context.type.body
            .copyWith(color: p.textPrimary, fontWeight: FontWeight.w800));
  }
}
