import 'package:cached_network_image/cached_network_image.dart';
import '../../hatly_service/presentation/widgets/route_summary.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/media/media_url.dart';
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
import 'item_unavailability_card.dart';

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
      loading: () => const _OrderDetailsScaffold(body: HatlyLoadingView()),
      error: (error, _) => _OrderDetailsScaffold(
        body: HatlyStateView(
          icon: Icons.error_outline,
          title: l10n.somethingWentWrong,
          retryLabel: l10n.retry,
          onRetry: () => ref.invalidate(orderDetailsProvider(orderId)),
        ),
      ),
      data: (order) =>
          _OrderDetailsScaffold(body: _OrderDetailsContent(order: order)),
    );
  }
}

/// The ONE scaffold of every Order Details state (loading, error, loaded), so Back behaves the same in all of them.
///
/// Order Details can be opened as the first route of the stack (a push-notification deep link, a cold start) as well as pushed
/// from the Orders list or the order-success screen. When there is a route beneath, the framework's own Back arrow (and the
/// iOS swipe / Android system Back) pops it. When there is NOT, there is nothing to pop: the AppBar shows an explicit Back
/// arrow that goes Home, and the system Back goes Home too instead of closing the app.
class _OrderDetailsScaffold extends StatelessWidget {
  const _OrderDetailsScaffold({required this.body});

  final Widget body;

  void _goHome(BuildContext context) => GoRouter.of(context).go('/');

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final canPop = Navigator.of(context).canPop();
    return PopScope(
      canPop: canPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _goHome(context);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.orderDetailsTitle),
          // With a route beneath, the framework supplies the (RTL-aware) back arrow itself.
          leading: canPop
              ? null
              : IconButton(
                  key: const Key('order-details-back'),
                  icon: const BackButtonIcon(),
                  tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                  onPressed: () => _goHome(context),
                ),
        ),
        body: body,
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
        if (order.partialRejection != null) ...[
          const SizedBox(height: HatlySpacing.ms),
          _PartialRejectionCard(order: order),
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
      icon: Icons.timeline_rounded,
            child: _OrderSurface(
                child: OrderTimelineView(entries: order.timeline)),
          ),
        ],
        if (order.driver != null) ...[
          const SizedBox(height: HatlySpacing.md),
          _DriverCard(driver: order.driver!),
        ],
        // 2b. A product turned out to be unavailable: the customer's one question (PD-016) — absent unless there is one.
        ItemUnavailabilityCard(orderId: order.id),
        // 3. Vendors + products (with options)
        const SizedBox(height: HatlySpacing.lg),
        HatlySection(
          title: l10n.orderVendorsLabel,
      icon: Icons.storefront_outlined,
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
        RemovedItemsSection(items: [for (final segment in order.segments) ...segment.removedItems]),
        // 4. Pricing (+ 6. discount / coupon)
        const SizedBox(height: HatlySpacing.sm),
        _PricingCard(order: order),
        // 5. Delivery breakdown
        if (order.deliveryRoute != null) ...[
          const SizedBox(height: HatlySpacing.md),
          HatlySection(
            title: AppLocalizations.of(context).routeOrderSectionTitle,
      icon: Icons.route_rounded,
            child: HatlySurface(
              child: RouteSummary(
                key: const Key('order-route'),
                origin: order.deliveryRoute!.origin,
                destination: order.deliveryRoute!.destination,
              ),
            ),
          ),
        ],
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
          messageBuilder: (l10n) => l10n.supportMessageOrder(order.orderNumber),
        ),
      ],
    );
  }
}

/// The Order Details card surface: the same flat, bordered, card-radius look as the legacy `HatlyCard` in Light Mode,
/// but built from the theme palette so it is also correct in Dark Mode (the legacy card is a fixed white).
/// "Part of your order was cancelled": which part, why (on each vendor card), what continues, and what has really been given back.
/// Refund lines come from the server's ledger summary only — a transfer refund is "sent" only once Hatly marked it sent.
class _PartialRejectionCard extends StatelessWidget {
  const _PartialRejectionCard({required this.order});

  final OrderDetails order;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final partial = order.partialRejection!;
    final refund = order.refundSummary;
    final lines = <String>[
      l10n.orderPartCancelledBody(
          partial.rejectedSegmentCount, partial.totalSegmentCount),
      if (refund.walletRefundedMinor > 0)
        l10n.orderRefundWalletLine(
            formatMinorUnits(refund.walletRefundedMinor, context)),
      if (refund.transferRefundSentMinor > 0)
        l10n.orderRefundTransferSentLine(
            formatMinorUnits(refund.transferRefundSentMinor, context)),
      if (refund.transferRefundAwaitingMinor > 0)
        l10n.orderRefundTransferPendingLine(
            formatMinorUnits(refund.transferRefundAwaitingMinor, context)),
      if (refund.pendingRefundMinor > 0)
        l10n.orderRefundReviewLine(
            formatMinorUnits(refund.pendingRefundMinor, context)),
      if (refund.isEmpty) l10n.orderPartCancelledNoCharge,
    ];
    return Container(
      key: const Key('order-partial-rejection'),
      child: _InfoCard(
        icon: Icons.info_outline,
        iconColor: context.palette.urgent,
        title: l10n.orderPartCancelledTitle,
        subtitle: lines.join('\n'),
      ),
    );
  }
}

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
                // AD_HOC_SERVICE segments have no vendorBranchName — mirrors
                // the cart's own `vendorName ?? adHocPlaceName` fallback (see
                // cart_vendor_section.dart) so the same request "title"
                // appears throughout cart, checkout and order history.
                segment.vendorBranchName ??
                    segment.adHocPlaceNameSnapshot ??
                    l10n.orderItemsTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              trailing: OrderStatusBadge(status: segment.status),
            ),
            if (segment.isAdHocService) ...[
              const SizedBox(height: HatlySpacing.xs),
              _AdHocServiceInfo(segment: segment),
            ],
            if (segment.isRejected && segment.rejectionReason != null) ...[
              const SizedBox(height: HatlySpacing.xs),
              Text(
                l10n.orderRejectionReasonLine(segment.rejectionReason!),
                key: Key('segment-rejection-${segment.id}'),
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: context.palette.urgent),
              ),
            ],
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
                isHatlyService: segment.isAdHocService,
                isDeliveryOnly: segment.isDeliveryOnly,
                ratingState:
                    _findProductItemRating(productRatingStates, item.id),
              ),
          ],
        ),
      ),
    );
  }
}

/// Service type + real, set-by-the-customer location for a standalone
/// Hatly Service segment — reads only the frozen snapshot fields (see
/// `OrderSegmentDetails`'s own doc comment); shows nothing for a
/// coordinate pair that was never captured, never a placeholder.
class _AdHocServiceInfo extends StatelessWidget {
  const _AdHocServiceInfo({required this.segment});

  final OrderSegmentDetails segment;

  String? _typeLabel(AppLocalizations l10n) {
    switch (segment.adHocServiceTypeSnapshot) {
      case 'BUY_FROM_PLACE':
        return l10n.hatlyServiceTypeBuyFromPlace;
      case 'DELIVER_TO_PLACE':
        return l10n.hatlyServiceTypeDeliverToPlace;
      default:
        return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final typeLabel = _typeLabel(l10n);
    final hasPickup = segment.adHocPickupLatitudeSnapshot != null &&
        segment.adHocPickupLongitudeSnapshot != null;
    final hasDestination = segment.adHocDestinationLatitudeSnapshot != null &&
        segment.adHocDestinationLongitudeSnapshot != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (typeLabel != null)
          Text('${l10n.orderHatlyServiceTypeLabel}: $typeLabel',
              style: context.type.caption.copyWith(color: p.textMuted)),
        if (hasPickup)
          Text(
              '${l10n.orderHatlyServicePickupLocationLabel}: ${l10n.orderHatlyServiceLocationCoordinates}',
              style: context.type.caption.copyWith(color: p.textMuted)),
        if (hasDestination)
          Text(
              '${l10n.orderHatlyServiceDestinationLocationLabel}: ${l10n.orderHatlyServiceLocationCoordinates}',
              style: context.type.caption.copyWith(color: p.textMuted)),
      ],
    );
  }
}

class _OrderItemRow extends ConsumerWidget {
  const _OrderItemRow(
      {required this.item,
      required this.orderId,
      this.isHatlyService = false,
      this.isDeliveryOnly = false,
      this.ratingState});

  final OrderItemDetails item;
  final String orderId;

  /// The item belongs to a Hatly Service request (not a vendor's own custom request) — only changes the wording of its
  /// pending-price text.
  final bool isHatlyService;

  /// Wasally: the item has no price — the delivery fee is the whole charge.
  final bool isDeliveryOnly;
  final ProductItemRatingState? ratingState;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final name =
        item.productNameSnapshot ?? item.freeTextDescriptionSnapshot ?? '';
    final productImageUrl = resolveMediaUrl(item.productImageUrlSnapshot);

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
                child: productImageUrl != null
                    ? CachedNetworkImage(
                        imageUrl: productImageUrl,
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
                              .map(resolveMediaUrl)
                              .whereType<String>()
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
              if (isDeliveryOnly)
                Flexible(
                  child: Text(l10n.hatlyServiceDeliveryOnly,
                      key: const Key('order-item-delivery-only'),
                      textAlign: TextAlign.end,
                      style: Theme.of(context)
                          .textTheme
                          .labelLarge
                          ?.copyWith(color: context.palette.textMuted)),
                )
              else if (item.displayAmountMinor != null)
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
              else if (item.isPricePending)
                // A custom request (vendor Custom Request or Hatly Service) whose final price isn't known yet — an explicit
                // pending state (`priceStatus == 'PENDING'`), NEVER shown as "0 EGP" or blank. A Hatly Service request says
                // exactly when it will be confirmed.
                Flexible(
                  child: Text(
                    isHatlyService
                        ? l10n.hatlyServicePricePending
                        : l10n.cartCustomRequestPricePending,
                    key: const Key('order-item-price-pending'),
                    textAlign: TextAlign.end,
                    style: Theme.of(context)
                        .textTheme
                        .labelLarge
                        ?.copyWith(color: context.palette.textMuted),
                  ),
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
      icon: Icons.receipt_long_outlined,
      child: _OrderSurface(
        child: Column(
          children: [
            // While a Hatly Service price is still pending the server's subtotal is only what is confirmed so far (0 when nothing is):
            // showing "0" would read as free, so the pending state is shown instead of a number.
            if (order.hasPendingPricing)
              OrderInfoRow(
                  key: const Key('order-subtotal-pending'),
                  label: l10n.cartSubtotal,
                  value: l10n.hatlyServicePricePending)
            else if (order.subtotalMinor != null)
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
                  bold: true)
            else if (order.hasPendingPricing)
              OrderInfoRow(
                  key: const Key('order-total-pending'),
                  label: l10n.orderTotalLabel,
                  value: l10n.hatlyServicePricePending,
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
      icon: Icons.delivery_dining_outlined,
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
            if (b.distanceMeters != null)
              OrderInfoRow(
                  label: l10n.checkoutBreakdownDistance,
                  value: l10n.checkoutDistanceKm(
                      (b.distanceMeters! / 1000).toStringAsFixed(1)),
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
      icon: Icons.payments_outlined,
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
      icon: Icons.location_on_outlined,
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
                  // The zone as frozen with the order ("بلبيس — أبو نصيب"), then the written address — never an internal id.
                  for (final line in address.detailLinesFor(
                      Localizations.localeOf(context).languageCode == 'ar'))
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
