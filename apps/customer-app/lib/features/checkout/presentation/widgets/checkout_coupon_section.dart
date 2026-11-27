import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/hatly_surface.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../domain/checkout_quote.dart';

/// A coupon code. Collapsed by default so it never crowds the checkout; the server validates the code, scopes it to one
/// vendor and computes the discount — the app only relays the code and shows the verdict.
class CheckoutCouponSection extends StatefulWidget {
  const CheckoutCouponSection({
    super.key,
    required this.coupon,
    required this.rejection,
    required this.isBusy,
    required this.onApply,
    required this.onRemove,
  });

  final QuoteCoupon coupon;

  /// The server's refusal of the last entered code (shown until the customer edits the code).
  final QuoteCoupon? rejection;
  final bool isBusy;
  final ValueChanged<String> onApply;
  final VoidCallback onRemove;

  @override
  State<CheckoutCouponSection> createState() => _CheckoutCouponSectionState();
}

class _CheckoutCouponSectionState extends State<CheckoutCouponSection> {
  final _code = TextEditingController();

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  String _rejectionMessage(AppLocalizations l10n, QuoteCoupon rejection) {
    switch (rejection.reasonCode) {
      // Hatly promotions (2026-11-27) answer with PROMO_* codes; same messages where the meaning is the same.
      case 'PROMO_NEW_CUSTOMERS_ONLY':
        return l10n.checkoutPromoNewCustomersOnly;
      case 'PROMO_TOO_MANY_ATTEMPTS':
        return l10n.checkoutPromoTooManyAttempts;
      case 'PROMO_NOT_FOUND':
      case 'PROMO_NOT_ACTIVE':
        return l10n.checkoutCouponNotFound;
      case 'PROMO_EXPIRED':
        return l10n.checkoutCouponExpired;
      case 'PROMO_NOT_STARTED':
        return l10n.checkoutCouponNotStarted;
      case 'PROMO_MIN_SUBTOTAL':
        return l10n.checkoutCouponMinimumNotMet;
      case 'PROMO_NOT_IN_SCOPE':
      case 'PROMO_NOTHING_TO_DISCOUNT':
      case 'PROMO_PRICE_PENDING':
        return l10n.checkoutCouponNotApplicable;
      case 'PROMO_NOT_COMBINABLE':
        return l10n.checkoutCouponConflictsWithOffer;
      case 'PROMO_CUSTOMER_LIMIT':
      case 'PROMO_USAGE_LIMIT':
      case 'PROMO_BUDGET_EXHAUSTED':
        return l10n.checkoutCouponLimitReached;
      case 'COUPON_NOT_FOUND':
      case 'COUPON_INACTIVE':
        return l10n.checkoutCouponNotFound;
      case 'COUPON_EXPIRED':
        return l10n.checkoutCouponExpired;
      case 'COUPON_NOT_STARTED':
        return l10n.checkoutCouponNotStarted;
      case 'COUPON_MINIMUM_NOT_MET':
        return l10n.checkoutCouponMinimumNotMet;
      case 'COUPON_NOT_APPLICABLE_TO_CART':
      case 'COUPON_NO_ELIGIBLE_ITEMS':
        return l10n.checkoutCouponNotApplicable;
      case 'COUPON_CONFLICTS_WITH_OFFER':
        return l10n.checkoutCouponConflictsWithOffer;
      case 'COUPON_USAGE_LIMIT_REACHED':
      case 'COUPON_CUSTOMER_LIMIT_REACHED':
      case 'COUPON_BUDGET_EXHAUSTED':
        return l10n.checkoutCouponLimitReached;
      default:
        return l10n.checkoutCouponRejected;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final coupon = widget.coupon;
    final rejection = widget.rejection;

    return HatlySurface(
      padding: EdgeInsets.zero,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          key: const Key('checkout-coupon'),
          // Stays open once a coupon is in play (applied, or the server just refused one).
          initiallyExpanded: coupon.isApplied || rejection != null,
          tilePadding: const EdgeInsets.symmetric(horizontal: HatlySpacing.md),
          childrenPadding: const EdgeInsets.fromLTRB(
              HatlySpacing.md, 0, HatlySpacing.md, HatlySpacing.md),
          leading: Icon(Icons.local_offer_outlined, color: p.textMuted),
          title: Text(l10n.checkoutCouponTitle,
              style: context.type.body.copyWith(fontWeight: FontWeight.w600)),
          children: [
            if (coupon.isApplied)
              Row(
                key: const Key('checkout-coupon-applied'),
                children: [
                  Icon(Icons.check_circle, color: p.success, size: 20),
                  const SizedBox(width: HatlySpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        LtrText(coupon.code ?? '',
                            style: context.type.body
                                .copyWith(fontWeight: FontWeight.w700)),
                        Text(
                          [
                            if (coupon.discountMinor != null)
                              l10n.checkoutCouponSaves(formatMinorUnits(
                                  coupon.discountMinor!, context)),
                            if (coupon.vendorName != null)
                              l10n.checkoutCouponForVendor(coupon.vendorName!),
                          ].join(' · '),
                          style: context.type.caption,
                        ),
                      ],
                    ),
                  ),
                  TextButton(
                    onPressed: widget.isBusy ? null : widget.onRemove,
                    child: Text(l10n.checkoutCouponRemove),
                  ),
                ],
              )
            else ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: TextField(
                      key: const Key('checkout-coupon-field'),
                      controller: _code,
                      textCapitalization: TextCapitalization.characters,
                      textInputAction: TextInputAction.done,
                      textDirection: TextDirection.ltr,
                      onSubmitted: widget.isBusy ? null : widget.onApply,
                      decoration: InputDecoration(
                        hintText: l10n.checkoutCouponHint,
                        errorText: rejection == null
                            ? null
                            : _rejectionMessage(l10n, rejection),
                      ),
                    ),
                  ),
                  const SizedBox(width: HatlySpacing.sm),
                  SizedBox(
                    height: 48,
                    child: OutlinedButton(
                      key: const Key('checkout-coupon-apply'),
                      style: OutlinedButton.styleFrom(
                          minimumSize: const Size(88, 48)),
                      onPressed: widget.isBusy
                          ? null
                          : () => widget.onApply(_code.text),
                      child: Text(l10n.checkoutCouponApply),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
