import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_price_label.dart';
import '../../../shared_widgets/ltr_text.dart';
import '../../ratings/data/rating_api.dart';
import '../../ratings/data/rating_providers.dart';
import '../../ratings/presentation/widgets/rating_action.dart';
import '../../checkout/presentation/payment_labels.dart';
import '../../support/presentation/support_contact_action.dart';
import '../data/orders_providers.dart';
import '../domain/order_details.dart';
import '../../checkout/domain/checkout_quote.dart';
import '../../../shared_widgets/hatly_key_value_row.dart';
import '../../../shared_widgets/hatly_surface.dart';
import 'order_status_label.dart';
import 'order_widgets.dart';

/// Real customer Order Details (this phase). Every product name/price
/// shown here comes from the OrderItem's own historical snapshot
/// fields — never a live catalog re-read — see OrderDetails/
/// OrderItemDetails' own doc comments and the backend's
/// CustomerOrdersService for why.
///
/// UI/UX-4 Chunk B. Presentation-only Design System migration —
/// section order, every data condition/mapping, callbacks, and
/// navigation are all UNCHANGED from before this chunk.
/// FAILED_DELIVERY presentation is deliberately NOT added here — the
/// Customer OrderDetails model/API does not currently expose
/// `failureReason`/`failedAt`; a FAILED_DELIVERY order still shows
/// only its existing OrderStatusBadge, unchanged.
class OrderDetailsScreen extends ConsumerWidget {
  const OrderDetailsScreen({super.key, required this.orderId});

  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final detailsAsync = ref.watch(orderDetailsProvider(orderId));

    return detailsAsync.when(
      loading: () => Scaffold(
        appBar: AppBar(title: Text(l10n.orderDetailsTitle)),
        body: const HatlyLoadingView(),
      ),
      error: (error, _) => Scaffold(
        appBar: AppBar(title: Text(l10n.orderDetailsTitle)),
        body: HatlyStateView(
          icon: Icons.error_outline,
          title: l10n.somethingWentWrong,
          retryLabel: l10n.retry,
          onRetry: () => ref.invalidate(orderDetailsProvider(orderId)),
        ),
      ),
      data: (order) => Scaffold(
        appBar: AppBar(title: Text(l10n.orderDetailsTitle)),
        body: _OrderDetailsContent(order: order),
      ),
    );
  }
}

class _OrderDetailsContent extends ConsumerWidget {
  const _OrderDetailsContent({required this.order});

  final OrderDetails order;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).languageCode;

    // Customer Ratings — loaded independently from the order itself
    // (Section 10: never blocks the rest of Order Details). `null`
    // while loading/erroring simply means no rating UI renders yet
    // for this build — the rest of the page is unaffected either way.
    final ratingState =
        ref.watch(orderRatingStateProvider(order.id)).valueOrNull;
    final awaiting = order.payment?.awaitingApproval ?? false;

    return ListView(
      padding: const EdgeInsets.all(HatlySpacing.md),
      children: [
        // 1. Status + ETA
        OrderStatusEtaCard(
          status: order.status,
          eta: order.eta,
          isPickup: order.isPickup,
          awaitingPaymentApproval: awaiting,
        ),
        const SizedBox(height: HatlySpacing.sm),
        Text(
          '${l10n.orderNumberLabel} ${orderNumberTag(order.orderNumber)} · ${DateFormat.yMMMd(locale).add_jm().format(order.createdAt.toLocal())}',
          style: context.type.caption,
        ),
        if (order.status == 'CANCELLED' &&
            order.cancellationReason != null) ...[
          const SizedBox(height: HatlySpacing.ms),
          _InfoCard(
            icon: Icons.info_outline,
            iconColor: context.palette.urgent,
            title: l10n.orderCancellationReasonLabel,
            subtitle: order.cancellationReason!,
          ),
        ],
        if (order.status == 'FAILED_DELIVERY' &&
            order.failureReason != null) ...[
          const SizedBox(height: HatlySpacing.ms),
          _InfoCard(
            icon: Icons.info_outline,
            iconColor: context.palette.urgent,
            title: l10n.orderFailureReasonLabel,
            subtitle: order.failedAt != null
                ? '${order.failureReason!}\n${DateFormat.yMMMd(locale).add_jm().format(order.failedAt!)}'
                : order.failureReason!,
          ),
        ],
        const SizedBox(height: HatlySpacing.md),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            key: const Key('order-track'),
            icon: const Icon(Icons.route_outlined),
            label: Text(l10n.orderTrackAction),
            onPressed: () => context.push('/orders/${order.id}/tracking'),
          ),
        ),
        // 2. Timeline
        if (order.timeline.isNotEmpty) ...[
          const SizedBox(height: HatlySpacing.lg),
          HatlySection(
            title: l10n.orderTimelineTitle,
            child: _OrderSurface(
                child: OrderTimelineView(entries: order.timeline)),
          ),
        ],
        if (order.driver != null) ...[
          const SizedBox(height: HatlySpacing.md),
          _DriverCard(driver: order.driver!),
        ],
        // 3. Vendors + products (with options)
        const SizedBox(height: HatlySpacing.lg),
        HatlySection(
          title: l10n.orderVendorsLabel,
          child: Column(
            children: [
              for (final segment in order.segments)
                _SegmentCard(
                  segment: segment,
                  orderId: order.id,
                  ratingState: _findVendorSegmentRating(
                      ratingState?.vendorSegments, segment.id),
                  productRatingStates: ratingState?.productItems,
                ),
            ],
          ),
        ),
        // 4. Pricing (+ 6. discount / coupon)
        const SizedBox(height: HatlySpacing.sm),
        _PricingCard(order: order),
        // 5. Delivery breakdown
        if (order.deliveryBreakdown != null) ...[
          const SizedBox(height: HatlySpacing.md),
          _DeliveryBreakdownCard(order: order),
        ],
        // 7. Wallet / payment
        const SizedBox(height: HatlySpacing.md),
        _PaymentCard(order: order),
        // 8. The address as it was when the order was placed (a frozen snapshot, never the live saved address)
        if (order.deliveryAddress != null) ...[
          const SizedBox(height: HatlySpacing.md),
          _AddressCard(address: order.deliveryAddress!),
        ],
        // Cancel — only when the server says the whole order can still be cancelled.
        if (order.customerCanCancel) ...[
          const SizedBox(height: HatlySpacing.lg),
          _CancelOrderButton(orderId: order.id),
        ],
        // 9. Support: the order reference is pre-filled so support can find the order quickly. Hidden entirely when no
        // support number is configured (nothing broken to show here).
        const SizedBox(height: HatlySpacing.md),
        SupportContactTile(
          key: const Key('order-support-contact'),
          label: l10n.supportContactOrderAction,
          hideWhenUnavailable: true,
          messageBuilder: (l10n) => l10n.supportMessageOrder(order.id),
        ),
      ],
    );
  }
}

/// The Order Details card surface: the same flat, bordered, card-radius look as the legacy `HatlyCard` in Light Mode,
/// but built from the theme palette so it is also correct in Dark Mode (the legacy card is a fixed white).
class _OrderSurface extends StatelessWidget {
  const _OrderSurface({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      padding: const EdgeInsets.all(HatlySpacing.md),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(HatlyRadius.card),
        border: Border.all(color: p.border),
      ),
      child: child,
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard(
      {required this.icon,
      required this.iconColor,
      required this.title,
      required this.subtitle});

  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return _OrderSurface(
      child: Row(
        children: [
          Icon(icon, color: iconColor),
          const SizedBox(width: HatlySpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: 2),
                Text(subtitle, style: Theme.of(context).textTheme.bodyLarge),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// CONFIRMED business decision: name + phone only, sourced from the
/// actual assigned Driver — no live location/tracking here (a
/// separate, unimplemented feature).
class _DriverCard extends StatelessWidget {
  const _DriverCard({required this.driver});

  final OrderDriverDetails driver;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _OrderSurface(
      child: Row(
        children: [
          const CircleAvatar(child: Icon(Icons.delivery_dining)),
          const SizedBox(width: HatlySpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.orderDriverTitle,
                    style: Theme.of(context).textTheme.bodyLarge),
                Text(driver.name,
                    style: Theme.of(context).textTheme.titleMedium),
                LtrText(driver.phone,
                    style: Theme.of(context).textTheme.bodyLarge),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Only meaningful when [ratingState] is non-null (the segment is a
/// real Vendor segment eligible for rating per the backend's own
/// rating-state response) — CONFIRMED: an AD_HOC_SERVICE segment or a
/// cancelled/not-yet-delivered one simply never appears in
/// `ratingState.vendorSegments` at all, so no rating action renders
/// for it, matching Section 4's "do not show a rating action on
/// non-eligible orders" exactly, with zero extra logic needed here.
class _SegmentCard extends ConsumerWidget {
  const _SegmentCard(
      {required this.segment,
      required this.orderId,
      this.ratingState,
      this.productRatingStates});

  final OrderSegmentDetails segment;
  final String orderId;
  final VendorSegmentRatingState? ratingState;
  final List<ProductItemRatingState>? productRatingStates;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: HatlySpacing.ms),
      child: _OrderSurface(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            HatlyTrailingRow(
              leading: Text(
                segment.vendorBranchName ?? l10n.orderItemsTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              trailing:
                  OrderStatusBadge(status: segment.status, themeAware: true),
            ),
            if (segment.hadSubtotalDiscount) ...[
              const SizedBox(height: HatlySpacing.xs),
              Text(
                l10n.orderHistoricalDiscountApplied(
                  formatMinorUnits(segment.offerDiscountAmountMinor!, context),
                ),
                style: Theme.of(context)
                    .textTheme
                    .labelLarge
                    ?.copyWith(color: context.palette.success),
              ),
            ],
            if (ratingState != null) ...[
              const SizedBox(height: HatlySpacing.xs),
              RatingAction(
                label: segment.vendorBranchName ?? l10n.orderItemsTitle,
                alreadyRated: ratingState!.alreadyRated,
                existingRating: ratingState!.rating,
                onSubmit: (stars, comment) async {
                  await ref.read(ratingApiProvider).rateVendor(
                        orderVendorSegmentId: ratingState!.orderVendorSegmentId,
                        stars: stars,
                        comment: comment,
                      );
                  ref.invalidate(orderRatingStateProvider(orderId));
                },
              ),
            ],
            const Divider(height: HatlySpacing.lg),
            for (final item in segment.items)
              _OrderItemRow(
                item: item,
                orderId: orderId,
                ratingState:
                    _findProductItemRating(productRatingStates, item.id),
              ),
          ],
        ),
      ),
    );
  }
}

class _OrderItemRow extends ConsumerWidget {
  const _OrderItemRow(
      {required this.item, required this.orderId, this.ratingState});

  final OrderItemDetails item;
  final String orderId;
  final ProductItemRatingState? ratingState;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final name =
        item.productNameSnapshot ?? item.freeTextDescriptionSnapshot ?? '';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: HatlySpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(HatlyRadius.imageContainer),
                child: item.productImageUrlSnapshot != null
                    ? CachedNetworkImage(
                        imageUrl: item.productImageUrlSnapshot!,
                        width: 48,
                        height: 48,
                        fit: BoxFit.cover,
                        placeholder: (context, url) => Container(
                            width: 48,
                            height: 48,
                            color: context.palette.surface),
                        errorWidget: (context, url, error) => SizedBox(
                          width: 48,
                          height: 48,
                          child: Icon(Icons.fastfood_outlined,
                              color: context.palette.textMuted),
                        ),
                      )
                    : SizedBox(
                        width: 48,
                        height: 48,
                        child: Icon(Icons.fastfood_outlined,
                            color: context.palette.textMuted),
                      ),
              ),
              const SizedBox(width: HatlySpacing.ms),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: Theme.of(context).textTheme.titleMedium),
                    // The options the customer picked, as frozen on the order (never re-read from the live catalog).
                    for (final option in item.optionsSnapshot)
                      Text(
                        option.priceDeltaMinor == 0
                            ? '${option.name}: ${option.valueName}'
                            : '${option.name}: ${option.valueName} (+${formatMinorUnits(option.priceDeltaMinor, context)})',
                        style: context.type.caption,
                      ),
                    if (item.notes?.isNotEmpty == true)
                      Text(item.notes!, style: context.type.caption),
                    if (item.productId == null &&
                        item.freeTextDescriptionSnapshot != null) ...[
                      Container(
                        margin: const EdgeInsets.only(top: 2, bottom: 2),
                        padding: const EdgeInsets.symmetric(
                            horizontal: HatlySpacing.sm, vertical: 1),
                        decoration: BoxDecoration(
                          color:
                              context.palette.textMuted.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(HatlyRadius.chip),
                        ),
                        child: Text(
                          l10n.cartCustomRequestBadge,
                          style: Theme.of(context)
                              .textTheme
                              .labelLarge
                              ?.copyWith(color: context.palette.textMuted),
                        ),
                      ),
                    ],
                    if (item.productId == null &&
                        (item.imageUrlsSnapshot?.isNotEmpty ?? false)) ...[
                      const SizedBox(height: HatlySpacing.xs),
                      SizedBox(
                        height: 36,
                        child: Row(
                          children: item.imageUrlsSnapshot!
                              .map(
                                (url) => Padding(
                                  padding: const EdgeInsets.only(
                                      right: HatlySpacing.sm),
                                  child: ClipRRect(
                                    borderRadius:
                                        BorderRadius.circular(HatlyRadius.chip),
                                    child: CachedNetworkImage(
                                        imageUrl: url,
                                        width: 36,
                                        height: 36,
                                        fit: BoxFit.cover),
                                  ),
                                ),
                              )
                              .toList(),
                        ),
                      ),
                    ],
                    if (item.hadFlashSale) ...[
                      Text(
                        l10n.orderHistoricalFlashSalePrice(
                          formatMinorUnits(
                              item.offerSpecialPriceMinorSnapshot ?? 0,
                              context),
                        ),
                        style: Theme.of(context)
                            .textTheme
                            .labelLarge
                            ?.copyWith(color: context.palette.link),
                      ),
                    ],
                    if (item.isWeighted) ...[
                      Text(
                        '${l10n.orderRequestedWeightLabel}: ${item.requestedWeightGrams ?? 0}g',
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                      if (item.actualWeightGrams != null)
                        Text(
                          '${l10n.orderActualWeightLabel}: ${item.actualWeightGrams}g',
                          style: Theme.of(context).textTheme.bodyLarge,
                        ),
                    ] else
                      Text('x${item.quantity}',
                          style: Theme.of(context).textTheme.bodyLarge),
                  ],
                ),
              ),
              if (item.displayAmountMinor != null)
                item.isWeighted
                    ? HatlyPriceLabel(
                        finalAmountMinor: item.displayAmountMinor,
                        estimatedAmountMinor: item.estimatedAmountMinor,
                        isPending: false,
                        pendingLabel: '',
                      )
                    : LtrText(
                        formatMinorUnits(item.displayAmountMinor!, context))
              else if (item.productId == null && item.actualAmountMinor != null)
                // Vendor/Pharmacy Custom Request whose final price has
                // now been recorded by a Vendor or Driver — the real
                // amount, never derived from unitPriceMinor/Order
                // totals/anything else.
                LtrText(formatMinorUnits(item.actualAmountMinor!, context))
              else if (item.productId == null)
                // Vendor/Pharmacy Custom Request whose final price
                // isn't known yet — NEVER shown as "0 EGP" or blank.
                Text(
                  l10n.cartCustomRequestPricePending,
                  style: Theme.of(context)
                      .textTheme
                      .labelLarge
                      ?.copyWith(color: context.palette.textMuted),
                ),
            ],
          ),
          // Only rendered when this item genuinely appears in the
          // backend's rating-state response — same non-eligible-is-
          // simply-absent reasoning as _SegmentCard above.
          if (ratingState != null)
            Padding(
              padding: const EdgeInsets.only(left: 60, top: HatlySpacing.xs),
              child: RatingAction(
                label: name,
                alreadyRated: ratingState!.alreadyRated,
                existingRating: ratingState!.rating,
                onSubmit: (stars, comment) async {
                  await ref.read(ratingApiProvider).rateProduct(
                        orderItemId: ratingState!.orderItemId,
                        stars: stars,
                        comment: comment,
                      );
                  ref.invalidate(orderRatingStateProvider(orderId));
                },
              ),
            ),
        ],
      ),
    );
  }
}

ProductItemRatingState? _findProductItemRating(
    List<ProductItemRatingState>? states, String orderItemId) {
  if (states == null) return null;
  for (final s in states) {
    if (s.orderItemId == orderItemId) return s;
  }
  return null;
}

VendorSegmentRatingState? _findVendorSegmentRating(
    List<VendorSegmentRatingState>? states, String segmentId) {
  if (states == null) return null;
  for (final s in states) {
    if (s.orderVendorSegmentId == segmentId) return s;
  }
  return null;
}

class _PricingCard extends StatelessWidget {
  const _PricingCard({required this.order});

  final OrderDetails order;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final coupon = order.coupon;
    final discount = order.discountMinor ?? 0;
    return HatlySection(
      title: l10n.orderPricingTitle,
      child: _OrderSurface(
        child: Column(
          children: [
            if (order.subtotalMinor != null)
              OrderInfoRow(
                  label: l10n.cartSubtotal,
                  value: formatMinorUnits(order.subtotalMinor!, context),
                  ltrValue: true),
            if (order.deliveryFeeMinor != null && !order.isPickup)
              OrderInfoRow(
                  label: l10n.deliveryFee,
                  value: formatMinorUnits(order.deliveryFeeMinor!, context),
                  ltrValue: true),
            if (discount > 0)
              OrderInfoRow(
                  label: l10n.orderDiscountLabel,
                  value: '-${formatMinorUnits(discount, context)}',
                  ltrValue: true,
                  color: p.success),
            if (coupon != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Text(
                    l10n.orderCouponLine(isolateLtr(coupon.code),
                        formatMinorUnits(coupon.discountMinor, context)),
                    key: const Key('order-coupon'),
                    style: context.type.caption.copyWith(color: p.success),
                  ),
                ),
              ),
            const Divider(height: HatlySpacing.lg),
            if (order.totalMinor != null)
              OrderInfoRow(
                  label: l10n.orderTotalLabel,
                  value: formatMinorUnits(order.totalMinor!, context),
                  ltrValue: true,
                  bold: true),
          ],
        ),
      ),
    );
  }
}

/// The delivery fee exactly as it was frozen when the order was placed — later changes to fee settings never rewrite it.
class _DeliveryBreakdownCard extends StatelessWidget {
  const _DeliveryBreakdownCard({required this.order});

  final OrderDetails order;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final b = order.deliveryBreakdown!;
    return HatlySection(
      title: l10n.orderDeliveryBreakdownTitle,
      child: _OrderSurface(
        child: Column(
          key: const Key('order-delivery-breakdown'),
          children: [
            OrderInfoRow(
                label: l10n.checkoutBreakdownBase,
                value: formatMinorUnits(b.baseFeeMinor, context),
                ltrValue: true),
            if (b.additionalVendorChargeMinor > 0)
              OrderInfoRow(
                  label: l10n
                      .checkoutBreakdownAdditionalVendors(b.vendorCount - 1),
                  value:
                      formatMinorUnits(b.additionalVendorChargeMinor, context),
                  ltrValue: true),
            OrderInfoRow(
                label: l10n.checkoutBreakdownDistance,
                value: l10n.checkoutDistanceKm(
                    (b.distanceMeters / 1000).toStringAsFixed(1)),
                ltrValue: true),
          ],
        ),
      ),
    );
  }
}

/// How the order is paid: the method (with the chosen electronic method), what the wallet covered, what is still due, and —
/// for a manual transfer — where the payment stands.
class _PaymentCard extends StatelessWidget {
  const _PaymentCard({required this.order});

  final OrderDetails order;

  String? _statusText(AppLocalizations l10n) {
    switch (order.payment?.status) {
      case 'PENDING':
        return l10n.orderPaymentStatusPending;
      case 'CUSTOMER_CLAIMED_TRANSFER':
      case 'UNDER_REVIEW':
        return l10n.orderPaymentStatusUnderReview;
      case 'PAID':
        return l10n.orderPaymentStatusPaid;
      case 'REJECTED':
        return l10n.orderPaymentStatusRejected;
      case 'DUE_ON_DELIVERY':
        return l10n.orderPaymentStatusDueOnDelivery;
      default:
        return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final payment = order.payment;
    final status = _statusText(l10n);
    final wallet = payment?.walletAmountMinor ?? order.walletAmountMinor;
    final due = payment?.amountDueMinor ?? order.amountDueMinor;
    return HatlySection(
      title: l10n.orderPaymentTitle,
      child: _OrderSurface(
        child: Column(
          key: const Key('order-payment'),
          children: [
            OrderInfoRow(
                label: l10n.orderPaymentMethodLabel,
                value: paymentSummaryLabel(
                    context, payment?.method ?? order.paymentMethod,
                    electronicMethod: payment?.electronicMethod ??
                        order.electronicPaymentMethod)),
            if (wallet > 0)
              OrderInfoRow(
                  label: l10n.checkoutWalletApplied,
                  value: formatMinorUnits(wallet, context),
                  ltrValue: true,
                  color: p.success),
            if (due != null && wallet > 0)
              OrderInfoRow(
                  label: l10n.checkoutAmountDue,
                  value: formatMinorUnits(due, context),
                  ltrValue: true),
            if (status != null)
              OrderInfoRow(
                  label: l10n.orderPaymentStatusLabel,
                  value: status,
                  color: payment?.awaitingApproval == true ? p.warning : null),
          ],
        ),
      ),
    );
  }
}

/// The delivery address frozen on the order — what the customer entered then, even if they have since edited or deleted it.
class _AddressCard extends StatelessWidget {
  const _AddressCard({required this.address});

  final QuoteAddressSnapshot address;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return HatlySection(
      title: l10n.orderDeliveryAddressTitle,
      child: _OrderSurface(
        child: Row(
          key: const Key('order-address'),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.location_on_outlined, color: p.textMuted),
            const SizedBox(width: HatlySpacing.ms),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (address.label?.isNotEmpty == true)
                    Text(address.label!, style: context.type.title),
                  for (final line in address.detailLines)
                    Text(line, style: context.type.body),
                  if (address.instructions?.isNotEmpty == true)
                    Text(address.instructions!, style: context.type.small),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Cancels the WHOLE order (never a single vendor). Only built when the server reported `customerCanCancel`; the server
/// re-checks on the request, so a race (a vendor just started preparing) ends in a clear message, not a broken state.
class _CancelOrderButton extends ConsumerStatefulWidget {
  const _CancelOrderButton({required this.orderId});

  final String orderId;

  @override
  ConsumerState<_CancelOrderButton> createState() => _CancelOrderButtonState();
}

class _CancelOrderButtonState extends ConsumerState<_CancelOrderButton> {
  bool _busy = false;

  Future<void> _cancel() async {
    final l10n = AppLocalizations.of(context);
    final result = await showDialog<({String reason})>(
      context: context,
      builder: (_) => const _CancelOrderDialog(),
    );
    if (result == null || !mounted) return;
    final text = result.reason.trim();

    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(ordersApiProvider)
          .cancelOrder(widget.orderId, reason: text);
      // The order changed state everywhere it is shown: lists, details, tracking.
      invalidateOrderCaches(ref.invalidate, orderId: widget.orderId);
      messenger.showSnackBar(SnackBar(content: Text(l10n.orderCancelDone)));
    } on ApiException catch (error) {
      if (!mounted) return;
      final blocked = error.businessCode == 'ORDER_NOT_CANCELLABLE_BY_CUSTOMER';
      messenger.showSnackBar(SnackBar(
          content: Text(
              blocked ? l10n.orderCancelNotAllowed : l10n.orderCancelFailed)));
      // The server's word is final: re-read so the button disappears if it no longer applies.
      invalidateOrderCaches(ref.invalidate, orderId: widget.orderId);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton(
        key: const Key('order-cancel'),
        style: OutlinedButton.styleFrom(
          foregroundColor: p.urgent,
          side: BorderSide(color: p.urgent),
        ),
        onPressed: _busy ? null : _cancel,
        child: _busy
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2))
            : Text(l10n.orderCancelAction),
      ),
    );
  }
}

/// The confirmation dialog for cancelling the whole order; owns its reason field so it is disposed with the dialog.
class _CancelOrderDialog extends StatefulWidget {
  const _CancelOrderDialog();

  @override
  State<_CancelOrderDialog> createState() => _CancelOrderDialogState();
}

class _CancelOrderDialogState extends State<_CancelOrderDialog> {
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(l10n.orderCancelConfirmTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l10n.orderCancelConfirmMessage),
          const SizedBox(height: HatlySpacing.md),
          TextField(
            key: const Key('order-cancel-reason'),
            controller: _reason,
            maxLength: 500,
            decoration: InputDecoration(hintText: l10n.orderCancelReasonHint),
          ),
        ],
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(l10n.orderCancelKeep)),
        TextButton(
          key: const Key('order-cancel-confirm'),
          onPressed: () => Navigator.of(context).pop((reason: _reason.text)),
          child: Text(l10n.orderCancelConfirmAction,
              style: TextStyle(color: context.palette.urgent)),
        ),
      ],
    );
  }
}
