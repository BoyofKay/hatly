import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/network/providers.dart';
import '../../cart/data/cart_providers.dart';
import '../../orders/data/orders_api.dart';
import '../../orders/data/orders_providers.dart';
import '../domain/checkout_quote.dart';
import 'checkout_api.dart';

final checkoutApiProvider =
    Provider<CheckoutApi>((ref) => CheckoutApi(ref.watch(apiClientProvider)));

/// The customer's checkout choices. Deliberately holds NO amounts: every number on screen comes from [CheckoutState.quote].
class CheckoutSelection {
  const CheckoutSelection({
    this.addressId,
    this.paymentMethod = 'COD',
    this.electronicMethod,
    this.useWallet = false,
    this.walletAmountMinor,
    this.couponCode,
  });

  /// Null = the server's default address.
  final String? addressId;
  final String paymentMethod;
  final String? electronicMethod;
  final bool useWallet;
  final int? walletAmountMinor;
  final String? couponCode;

  bool get needsElectronicMethod =>
      paymentMethod == 'PAY_AT_DELIVERY' || paymentMethod == 'MANUAL_TRANSFER';

  CheckoutSelection copyWith({
    Object? addressId = _keep,
    String? paymentMethod,
    Object? electronicMethod = _keep,
    bool? useWallet,
    Object? walletAmountMinor = _keep,
    Object? couponCode = _keep,
  }) {
    return CheckoutSelection(
      addressId:
          identical(addressId, _keep) ? this.addressId : addressId as String?,
      paymentMethod: paymentMethod ?? this.paymentMethod,
      electronicMethod: identical(electronicMethod, _keep)
          ? this.electronicMethod
          : electronicMethod as String?,
      useWallet: useWallet ?? this.useWallet,
      walletAmountMinor: identical(walletAmountMinor, _keep)
          ? this.walletAmountMinor
          : walletAmountMinor as int?,
      couponCode: identical(couponCode, _keep)
          ? this.couponCode
          : couponCode as String?,
    );
  }
}

const Object _keep = Object();

/// Why the order was not created although the customer pressed "place order".
class CheckoutStaleNotice {
  const CheckoutStaleNotice({required this.reason, required this.changes});

  /// `QUOTE_EXPIRED` · `INPUTS_CHANGED` · `AMOUNTS_CHANGED`.
  final String reason;
  final List<String> changes;
}

class CheckoutState {
  const CheckoutState({
    this.selection = const CheckoutSelection(),
    this.quote,
    this.isQuoting = true,
    this.quoteError,
    this.couponRejection,
    this.staleNotice,
    this.isSubmitting = false,
  });

  final CheckoutSelection selection;
  final CheckoutQuote? quote;

  /// A (re)quote is in flight. The previous [quote] stays visible meanwhile so the screen never blanks on every tap.
  final bool isQuoting;
  final ApiException? quoteError;

  /// The server's reason the entered coupon was refused — shown next to the coupon field; the code is not kept.
  final QuoteCoupon? couponRejection;

  /// Set when the quote the customer confirmed no longer matches the price — they must confirm the new one.
  final CheckoutStaleNotice? staleNotice;
  final bool isSubmitting;

  bool get canSubmit =>
      !isQuoting &&
      !isSubmitting &&
      quote != null &&
      quote!.canPlaceOrder &&
      (!selection.needsElectronicMethod || selection.electronicMethod != null);

  CheckoutState copyWith({
    CheckoutSelection? selection,
    Object? quote = _keep,
    bool? isQuoting,
    Object? quoteError = _keep,
    Object? couponRejection = _keep,
    Object? staleNotice = _keep,
    bool? isSubmitting,
  }) {
    return CheckoutState(
      selection: selection ?? this.selection,
      quote: identical(quote, _keep) ? this.quote : quote as CheckoutQuote?,
      isQuoting: isQuoting ?? this.isQuoting,
      quoteError: identical(quoteError, _keep)
          ? this.quoteError
          : quoteError as ApiException?,
      couponRejection: identical(couponRejection, _keep)
          ? this.couponRejection
          : couponRejection as QuoteCoupon?,
      staleNotice: identical(staleNotice, _keep)
          ? this.staleNotice
          : staleNotice as CheckoutStaleNotice?,
      isSubmitting: isSubmitting ?? this.isSubmitting,
    );
  }
}

/// The outcome of [CheckoutController.placeOrder].
class PlaceOrderOutcome {
  const PlaceOrderOutcome.created(this.order)
      : stale = false,
        error = null;
  const PlaceOrderOutcome.stale()
      : order = null,
        stale = true,
        error = null;
  const PlaceOrderOutcome.failed(this.error)
      : order = null,
        stale = false;

  final CreatedOrderResult? order;
  final bool stale;
  final ApiException? error;
}

/// Drives the checkout screen: keeps the selection, asks the server for the authoritative quote whenever it changes
/// (latest request wins), and places the order with the confirmed quote token. A stale quote is never silently accepted:
/// the server refuses it, this controller shows the current quote and the customer confirms again.
class CheckoutController extends StateNotifier<CheckoutState> {
  CheckoutController(this._checkoutApi, this._ordersApi, this._ref,
      {bool autoLoad = true})
      : super(const CheckoutState()) {
    if (autoLoad) unawaited(refresh());
  }

  final CheckoutApi _checkoutApi;
  final OrdersApi _ordersApi;
  final Ref _ref;
  int _sequence = 0;

  CheckoutRequest _request({bool forOrder = false}) {
    final s = state.selection;
    final q = state.quote;
    // When the wallet alone covers the total the server has resolved the method to WALLET; the order must say so (and carry
    // no electronic method — there is nothing left to pay electronically).
    final walletCoversAll = forOrder && q?.payment?.method == 'WALLET';
    // The quote may have preselected the customer's default address (selection null = "server default"). Order creation does
    // not resolve defaults, so the order must name the exact saved address the customer was quoted and confirmed.
    final quotedAddressId = q?.address?.addressId;
    return CheckoutRequest(
      addressId: s.addressId ?? (forOrder ? quotedAddressId : null),
      paymentMethod: walletCoversAll ? 'WALLET' : s.paymentMethod,
      electronicPaymentMethod: walletCoversAll ? null : s.electronicMethod,
      useWallet: s.useWallet,
      walletAmountMinor: s.walletAmountMinor,
      couponCode: s.couponCode,
      quoteToken: forOrder ? q?.quoteToken : null,
    );
  }

  /// Re-asks the server for the quote (also the retry after an error). When the customer CHANGED something (address / zone,
  /// payment, coupon…) and the new quote fails, the previous quote is dropped: its fee and token belong to the old choice and
  /// must never stay on screen — or be submitted — as if they were the new one.
  Future<void> refresh({bool selectionChanged = false}) async {
    final ticket = ++_sequence;
    state = state.copyWith(isQuoting: true, quoteError: null);
    try {
      final quote = await _checkoutApi.quote(_request());
      if (ticket != _sequence || !mounted) return;
      await _applyQuote(quote);
    } on ApiException catch (error) {
      if (ticket != _sequence || !mounted) return;
      state = state.copyWith(
          isQuoting: false,
          quoteError: error,
          quote: selectionChanged ? null : state.quote);
    } catch (error) {
      if (ticket != _sequence || !mounted) return;
      state = state.copyWith(
          isQuoting: false,
          quoteError: ApiException(code: 'UNKNOWN_ERROR', message: '$error'),
          quote: selectionChanged ? null : state.quote);
    }
  }

  Future<void> _applyQuote(CheckoutQuote quote) async {
    // The chosen saved address no longer exists (deleted meanwhile): fall back to the server's default.
    if (quote.hasBlocker('ADDRESS_NOT_FOUND') &&
        state.selection.addressId != null) {
      state =
          state.copyWith(selection: state.selection.copyWith(addressId: null));
      await refresh();
      return;
    }
    // The server refused the coupon: remember why, drop the code (an order with a refused coupon is rejected) and quote
    // again so the token matches what will be submitted.
    if (quote.coupon.isRejected && state.selection.couponCode != null) {
      state = state.copyWith(
        selection: state.selection.copyWith(couponCode: null),
        couponRejection: quote.coupon,
      );
      await refresh();
      return;
    }
    // The wallet stopped being available (e.g. the cart now has a weighed item): stop asking for it.
    if (state.selection.useWallet && quote.payment?.wallet.available == false) {
      state = state.copyWith(
          selection: state.selection
              .copyWith(useWallet: false, walletAmountMinor: null));
      await refresh();
      return;
    }
    // A method that just became unavailable falls back to cash on delivery instead of blocking the order.
    final options = quote.payment?.options;
    final s = state.selection;
    if (options != null) {
      final unavailable = (s.paymentMethod == 'MANUAL_TRANSFER' &&
              !options.manualTransferAvailable) ||
          (s.paymentMethod == 'PAY_AT_DELIVERY' && !options.payAtDelivery);
      if (unavailable) {
        state = state.copyWith(
            selection:
                s.copyWith(paymentMethod: 'COD', electronicMethod: null));
        await refresh();
        return;
      }
      if (s.needsElectronicMethod &&
          s.electronicMethod != null &&
          !options.electronicMethods.contains(s.electronicMethod)) {
        state = state.copyWith(selection: s.copyWith(electronicMethod: null));
      }
    }
    state = state.copyWith(quote: quote, isQuoting: false, quoteError: null);
  }

  void _update(CheckoutSelection selection) {
    state = state.copyWith(selection: selection, staleNotice: null);
    unawaited(refresh(selectionChanged: true));
  }

  void selectAddress(String addressId) =>
      _update(state.selection.copyWith(addressId: addressId));

  /// Drops an explicit choice so the server's default address is used again (e.g. after the chosen one was deleted).
  void useDefaultAddress() =>
      _update(state.selection.copyWith(addressId: null));

  void selectPayment(String method, {String? electronicMethod}) {
    // The wallet is an independent payment source (PD-001): it stays on whichever method pays the remainder.
    _update(state.selection.copyWith(
      paymentMethod: method,
      electronicMethod: electronicMethod,
    ));
  }

  void selectElectronicMethod(String method) =>
      _update(state.selection.copyWith(electronicMethod: method));

  void setUseWallet(bool value) => _update(state.selection.copyWith(
      useWallet: value,
      walletAmountMinor: value ? state.selection.walletAmountMinor : null));

  /// Caps the wallet share (null = as much as the balance and the total allow).
  void setWalletAmount(int? amountMinor) =>
      _update(state.selection.copyWith(walletAmountMinor: amountMinor));

  void applyCoupon(String code) {
    final trimmed = code.trim();
    if (trimmed.isEmpty) return;
    state = state.copyWith(couponRejection: null);
    _update(state.selection.copyWith(couponCode: trimmed.toUpperCase()));
  }

  void removeCoupon() {
    state = state.copyWith(couponRejection: null);
    _update(state.selection.copyWith(couponCode: null));
  }

  /// Switches Delivery ⇄ Pickup on the cart itself (the server owns that setting), then re-quotes.
  Future<ApiException?> setFulfillment(String type) async {
    final error = await _ref
        .read(cartControllerProvider.notifier)
        .setFulfillmentType(type);
    if (error == null) {
      state = state.copyWith(staleNotice: null);
      await refresh();
    }
    return error;
  }

  /// Places the order with the quote the customer just saw. Returns the created order, `stale` (the server refused the old
  /// price and the current quote is now on screen for the customer to confirm again) or the failure.
  Future<PlaceOrderOutcome> placeOrder() async {
    if (state.isSubmitting) {
      return const PlaceOrderOutcome.failed(
          ApiException(code: 'BUSY', message: 'Already submitting.'));
    }
    final selection = state.selection;
    state = state.copyWith(isSubmitting: true, staleNotice: null);
    try {
      final request = _request(forOrder: true);
      final order = await _ordersApi.createOrder(request);
      if (mounted) state = state.copyWith(isSubmitting: false);
      // The server flipped the cart to ORDERED: the cached cart is superseded.
      _ref.invalidate(cartControllerProvider);
      // ...and the orders lists now miss the new order.
      invalidateOrderCaches(_ref.invalidate);
      return PlaceOrderOutcome.created(order);
    } on ApiException catch (error) {
      if (!mounted) return PlaceOrderOutcome.failed(error);
      if (error.businessCode == 'QUOTE_STALE') {
        final details = error.details as Map;
        final current = details['currentQuote'];
        state = state.copyWith(
          isSubmitting: false,
          selection: selection,
          quote: current is Map<String, dynamic>
              ? CheckoutQuote.fromJson(current)
              : state.quote,
          isQuoting: false,
          staleNotice: CheckoutStaleNotice(
            reason: (details['reason'] as String?) ?? 'AMOUNTS_CHANGED',
            changes: (details['changes'] as List? ?? [])
                .map((e) => e.toString())
                .toList(),
          ),
        );
        return const PlaceOrderOutcome.stale();
      }
      state = state.copyWith(isSubmitting: false);
      // The situation may have moved on (stock, service area…): show the truth again.
      unawaited(refresh());
      return PlaceOrderOutcome.failed(error);
    } catch (error) {
      if (mounted) state = state.copyWith(isSubmitting: false);
      return PlaceOrderOutcome.failed(
          ApiException(code: 'UNKNOWN_ERROR', message: '$error'));
    }
  }
}

/// Auto-disposed: every visit to Checkout starts from a fresh server quote, never a cached one.
final checkoutControllerProvider =
    StateNotifierProvider.autoDispose<CheckoutController, CheckoutState>((ref) {
  return CheckoutController(
      ref.watch(checkoutApiProvider), ref.watch(ordersApiProvider), ref);
});
