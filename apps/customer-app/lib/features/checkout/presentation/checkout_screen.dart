import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../shared_widgets/hatly_key_value_row.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/ltr_text.dart';
import '../../addresses/domain/saved_address.dart';
import '../../cart/data/cart_providers.dart';
import '../../cart/domain/cart.dart';
import '../data/checkout_controller.dart';
import '../domain/checkout_quote.dart';
import 'checkout_error_messages.dart';
import 'widgets/checkout_address_section.dart';
import 'widgets/checkout_coupon_section.dart';
import 'widgets/checkout_delivery_section.dart';
import 'widgets/checkout_fulfillment_section.dart';
import 'widgets/checkout_payment_section.dart';
import 'widgets/checkout_summary_section.dart';
import 'widgets/checkout_wallet_section.dart';

/// Checkout. Order of the page: fulfilment + address → delivery estimate (expandable breakdown) → payment → wallet → coupon
/// → order summary; the total and the confirm button stay pinned at the bottom.
///
/// Everything numeric — fee, discount, wallet split, ETA, total — comes from the server's quote
/// ([CheckoutController]); this screen never prices anything. The quote is asked for again whenever a choice changes, and the
/// order is placed with the quote token the customer confirmed: if it went stale the server refuses, this screen shows the
/// current quote and the customer confirms again.
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key});

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  String? _submitError;

  Future<void> _pickAddress() async {
    final result = await context.push<SavedAddress>('/checkout/address');
    if (result != null && mounted) {
      ref.read(checkoutControllerProvider.notifier).selectAddress(result.id);
    }
  }

  Future<void> _changeFulfillment(String type) async {
    final error = await ref
        .read(checkoutControllerProvider.notifier)
        .setFulfillment(type);
    if (error != null && mounted) {
      setState(
          () => _submitError = localizedCheckoutErrorMessage(context, error));
    }
  }

  Future<void> _submit() async {
    setState(() => _submitError = null);
    final outcome =
        await ref.read(checkoutControllerProvider.notifier).placeOrder();
    if (!mounted) return;
    final order = outcome.order;
    if (order != null) {
      // Home stays underneath; the success screen replaces the whole checkout flow.
      context.go('/');
      context.push('/checkout/success/${order.id}');
    } else if (outcome.error != null) {
      setState(() => _submitError =
          localizedCheckoutErrorMessage(context, outcome.error!));
    }
    // A stale quote needs no message here: the screen now shows the current quote and the notice.
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final cartAsync = ref.watch(cartControllerProvider);
    final checkout = ref.watch(checkoutControllerProvider);
    final controller = ref.read(checkoutControllerProvider.notifier);
    final quote = checkout.quote;

    Widget body;
    if (cartAsync.hasError && !cartAsync.hasValue) {
      body = HatlyStateView(
        icon: Icons.error_outline,
        title: l10n.somethingWentWrong,
        retryLabel: l10n.retry,
        onRetry: () => ref.read(cartControllerProvider.notifier).refresh(),
      );
    } else if (quote == null && checkout.quoteError != null) {
      body = HatlyStateView(
        icon: Icons.error_outline,
        title: localizedCheckoutErrorMessage(context, checkout.quoteError!),
        retryLabel: l10n.retry,
        onRetry: controller.refresh,
      );
    } else if (quote == null || !cartAsync.hasValue) {
      body = const HatlyLoadingView();
    } else if (quote.isEmptyCart) {
      body = HatlyStateView(
        icon: Icons.shopping_cart_outlined,
        title: l10n.cartEmptyTitle,
        retryLabel: l10n.cart,
        onRetry: () => context.pop(),
      );
    } else {
      body = _Content(
        quote: quote,
        checkout: checkout,
        submitError: _submitError,
        onPickAddress: _pickAddress,
        onChangeFulfillment: _changeFulfillment,
        cartItems: cartAsync.requireValue,
      );
    }

    return Scaffold(
      appBar: AppBar(title: Text(l10n.checkoutTitle)),
      body: Column(
        children: [
          Expanded(child: body),
          if (quote != null && !quote.isEmptyCart)
            _StickyBar(checkout: checkout, onSubmit: _submit),
        ],
      ),
    );
  }
}

class _Content extends ConsumerWidget {
  const _Content({
    required this.quote,
    required this.checkout,
    required this.submitError,
    required this.onPickAddress,
    required this.onChangeFulfillment,
    required this.cartItems,
  });

  final CheckoutQuote quote;
  final CheckoutState checkout;
  final String? submitError;
  final VoidCallback onPickAddress;
  final ValueChanged<String> onChangeFulfillment;
  final Cart cartItems;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final controller = ref.read(checkoutControllerProvider.notifier);
    final selection = checkout.selection;
    final blockerMessages = <String>{
      for (final b in quote.blockers)
        if (checkoutBlockerMessage(context, b.code) case final message?)
          message,
    };

    return ListView(
      padding: const EdgeInsets.all(HatlySpacing.md),
      children: [
        if (checkout.staleNotice != null) ...[
          _Banner(
            key: const Key('checkout-stale-notice'),
            icon: Icons.info_outline,
            color: p.warning,
            text: checkout.staleNotice!.reason == 'QUOTE_EXPIRED'
                ? l10n.checkoutStaleExpired
                : l10n.checkoutStaleChanged,
          ),
          const SizedBox(height: HatlySpacing.md),
        ],
        if (quote.fulfillment != null) ...[
          CheckoutFulfillmentSection(
            fulfillment: quote.fulfillment!,
            enabled: !checkout.isSubmitting,
            onChanged: onChangeFulfillment,
          ),
          const SizedBox(height: HatlySpacing.lg),
        ],
        CheckoutAddressSection(quote: quote, onPickAddress: onPickAddress),
        const SizedBox(height: HatlySpacing.lg),
        CheckoutDeliverySection(quote: quote),
        if (quote.delivery != null) const SizedBox(height: HatlySpacing.lg),
        if (quote.payment != null) ...[
          CheckoutPaymentSection(
            quote: quote,
            selection: selection,
            onSelect: (method, electronic) =>
                controller.selectPayment(method, electronicMethod: electronic),
            onSelectElectronic: controller.selectElectronicMethod,
          ),
          const SizedBox(height: HatlySpacing.lg),
          // U2: a pickup order is paid in cash at the counter — the wallet is never offered for it.
          if (!(quote.fulfillment?.isPickup ?? false)) ...[
            CheckoutWalletSection(
              quote: quote,
              selection: selection,
              onToggle: controller.setUseWallet,
              onAmount: controller.setWalletAmount,
            ),
            const SizedBox(height: HatlySpacing.lg),
          ],
        ],
        CheckoutCouponSection(
          coupon: quote.coupon,
          rejection: checkout.couponRejection,
          isBusy: checkout.isQuoting || checkout.isSubmitting,
          onApply: controller.applyCoupon,
          onRemove: controller.removeCoupon,
        ),
        const SizedBox(height: HatlySpacing.lg),
        CheckoutItemsSummary(cart: cartItems),
        CheckoutTotals(quote: quote),
        for (final message in blockerMessages) ...[
          const SizedBox(height: HatlySpacing.sm),
          _Banner(
            key: const Key('checkout-blocker'),
            icon: Icons.error_outline,
            color: p.urgent,
            text: message,
          ),
        ],
        if (submitError != null) ...[
          const SizedBox(height: HatlySpacing.sm),
          _Banner(
            key: const Key('checkout-submit-error'),
            icon: Icons.error_outline,
            color: p.urgent,
            text: submitError!,
          ),
        ],
        const SizedBox(height: HatlySpacing.md),
      ],
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner(
      {super.key, required this.icon, required this.color, required this.text});

  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(HatlySpacing.ms),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(HatlyRadius.card),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color, size: 20),
            const SizedBox(width: HatlySpacing.sm),
            Expanded(
                child: Text(text,
                    style: context.type.small
                        .copyWith(color: context.palette.textPrimary))),
          ],
        ),
      ),
    );
  }
}

/// The pinned bottom bar: the total (what the customer will be charged), what is still due after the wallet, and the confirm
/// button. Disabled — with the reason — until the server says the order can be placed.
class _StickyBar extends ConsumerWidget {
  const _StickyBar({required this.checkout, required this.onSubmit});

  final CheckoutState checkout;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final quote = checkout.quote!;
    final summary = quote.summary;
    final total = summary?.totalMinor;
    final due = summary?.amountDueMinor;
    final showDue =
        summary != null && summary.walletAppliedMinor > 0 && due != null;

    String? hint;
    if (!checkout.canSubmit && !checkout.isQuoting) {
      if (checkout.selection.needsElectronicMethod &&
          checkout.selection.electronicMethod == null) {
        hint = l10n.checkoutChooseElectronicMethod;
      } else if (quote.address?.snapshot == null &&
          !(quote.fulfillment?.isPickup ?? false)) {
        hint = l10n.checkoutSelectAddressCta;
      } else if (quote.eligibility != null && !quote.eligibility!.serviceable) {
        hint = switch (quote.eligibility!.code) {
          'ADDRESS_ZONE_REQUIRED' => l10n.checkoutAddressZoneRequired,
          'DELIVERY_ZONE_UNAVAILABLE' => l10n.checkoutAddressZoneUnavailable,
          _ => l10n.checkoutAddressOutOfServiceArea,
        };
      }
    }

    return Material(
      color: p.surface,
      elevation: 8,
      shadowColor: p.shadow,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(HatlySpacing.md, HatlySpacing.ms,
              HatlySpacing.md, HatlySpacing.ms),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(l10n.orderTotalLabel, style: context.type.body),
                  ),
                  if (checkout.isQuoting)
                    const Padding(
                      padding: EdgeInsetsDirectional.only(end: HatlySpacing.sm),
                      child: SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2)),
                    ),
                  Flexible(
                      child: Semantics(
                    liveRegion: true,
                    child: total == null
                        ? Text(
                            quote.hasPendingPricing
                                ? l10n.hatlyServicePricePending
                                : l10n.checkoutTotalPending,
                            key: const Key('checkout-total'),
                            style: quote.hasPendingPricing
                                ? context.type.small
                                : context.type.title)
                        : LtrText(
                            formatMinorUnits(total, context),
                            key: const Key('checkout-total'),
                            style: context.type.h2,
                          ),
                  )),
                ],
              ),
              if (showDue)
                Row(
                  children: [
                    Expanded(
                        child: Text(l10n.checkoutAmountDue,
                            style: context.type.small)),
                    LtrText(formatMinorUnits(due, context),
                        style:
                            context.type.small.copyWith(color: p.textPrimary)),
                  ],
                ),
              if (hint != null)
                Padding(
                  padding: const EdgeInsets.only(top: HatlySpacing.xs),
                  child: Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: Text(hint,
                        key: const Key('checkout-cta-hint'),
                        style: context.type.caption.copyWith(color: p.warning)),
                  ),
                ),
              const SizedBox(height: HatlySpacing.sm),
              SizedBox(
                // Polish pass: was `height: 52`, 4px taller than every other
                // primary button in this app (the theme's own
                // `ElevatedButtonThemeData.minimumSize` is 48px, e.g. this
                // same `hatlyAccentButtonStyle` used on Order Success).
                width: double.infinity,
                child: ElevatedButton(
                  key: const Key('checkout-confirm'),
                  style: hatlyAccentButtonStyle(context),
                  onPressed: checkout.canSubmit ? onSubmit : null,
                  child: checkout.isSubmitting
                      ? SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: p.accentOn))
                      : Text(quote.payment?.awaitsPaymentApproval == true
                          ? l10n.checkoutConfirmAndPay
                          : l10n.checkoutPlaceOrderButton),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
