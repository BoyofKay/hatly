import 'package:flutter/widgets.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/network/api_exception.dart';

/// Customer Offers Integration. Checkout-time structured business
/// errors — mirrors cart_error_messages.dart's exact pattern (switch
/// on [ApiException.businessCode] first, generic HTTP-status fallback
/// second).
String localizedCheckoutErrorMessage(BuildContext context, ApiException error) {
  final l10n = AppLocalizations.of(context);

  switch (error.businessCode) {
    case 'FLASH_SALE_LIMIT_EXCEEDED':
      final details = error.details;
      final remaining = details is Map ? details['remaining'] : null;
      if (remaining is num) {
        return l10n
            .checkoutErrorFlashSaleLimitWithRemaining(remaining.toString());
      }
      return l10n.checkoutErrorFlashSaleLimit;
    case 'INSUFFICIENT_INVENTORY':
      return l10n.checkoutErrorInsufficientInventory;
    case 'OFFER_MECHANISM_CONFLICT':
      return l10n.checkoutErrorOfferConflict;
    case 'MANUAL_TRANSFER_NOT_CONFIGURED':
      return l10n.checkoutTransferUnavailable;
    case 'WALLET_INSUFFICIENT_BALANCE':
      return l10n.checkoutErrorWalletInsufficient;
    case 'ADDRESS_OUT_OF_SERVICE_AREA':
    case 'VENDOR_DOES_NOT_DELIVER':
    case 'VENDOR_OUTSIDE_DELIVERY_AREA':
      return l10n.checkoutAddressOutOfServiceArea;
    case 'BRANCH_CLOSED':
    case 'BRANCH_OUTSIDE_OPENING_HOURS':
    case 'BRANCH_TEMPORARILY_CLOSED':
      return l10n.checkoutErrorStoreClosed;
    case 'PRODUCT_UNAVAILABLE':
    case 'BRANCH_UNAVAILABLE':
      return l10n.checkoutBlockerUnavailable;
    case 'BUY_FROM_PLACE_PICKUP_REQUIRED':
      return l10n.checkoutBlockerAdHocPickupRequired;
    case 'DELIVER_TO_PLACE_DESTINATION_REQUIRED':
    case 'SERVICE_DESTINATION_REQUIRED':
      return l10n.checkoutBlockerAdHocDestinationRequired;
    case 'DELIVER_TO_PLACE_ORIGIN_REQUIRED':
      return l10n.checkoutBlockerAdHocOriginRequired;
    case 'HATLY_DEFAULT_PICKUP_NOT_CONFIGURED':
      return l10n.checkoutBlockerHatlyDefaultPickupMissing;
    case 'HATLY_DEFAULT_DESTINATION_NOT_CONFIGURED':
      return l10n.checkoutBlockerHatlyDefaultDestinationMissing;
    case 'WASALLY_DEFAULT_DESTINATION_NOT_CONFIGURED':
      return l10n.checkoutBlockerWasallyDefaultDestinationMissing;
    // Order-creation rejections the backend raises with a specific code (checkout-planner / order-creation services).
    case 'ADDRESS_NOT_SERVICEABLE':
      return l10n.checkoutAddressOutOfServiceArea;
    case 'ADDRESS_ZONE_REQUIRED':
      return l10n.checkoutAddressZoneRequired;
    case 'DELIVERY_ZONE_UNAVAILABLE':
      return l10n.checkoutAddressZoneUnavailable;
    case 'DELIVERY_ADDRESS_REQUIRED':
    case 'ADDRESS_REQUIRED':
      return l10n.checkoutErrorAddressRequired;
    case 'INVALID_DELIVERY_LOCATION':
    case 'INVALID_DELIVERY_ADDRESS':
      return l10n.checkoutBlockerInvalidAddress;
    case 'EMPTY_CART':
      return l10n.checkoutErrorEmptyCart;
    case 'QUOTE_TOKEN_REQUIRED':
    case 'QUOTE_INVALID':
      return l10n.checkoutErrorQuoteRequired;
    case 'PAYMENT_METHOD_REQUIRED':
      return l10n.checkoutErrorPaymentMethodRequired;
    case 'ONLINE_PAYMENT_NOT_AVAILABLE':
      return l10n.checkoutErrorOnlinePaymentUnavailable;
    // Hatly Service with a price not confirmed yet is COD-only (the checkout screen never offers anything else; these are the
    // defensive messages if a stale selection ever reaches the server).
    case 'ELECTRONIC_PAYMENT_NOT_ALLOWED_FOR_UNPRICED_ORDER':
      return l10n.checkoutTransferUnavailableUnpriced;
    case 'WALLET_NOT_ALLOWED_FOR_UNPRICED_ORDER':
    case 'WALLET_NOT_ALLOWED_FOR_WEIGHTED_ORDER':
      return l10n.checkoutWalletUnavailableForOrder;
    case 'MANUAL_TRANSFER_NOT_ALLOWED_FOR_WEIGHTED_ORDER':
      return l10n.checkoutTransferUnavailableWeighed;
    case 'MULTI_VENDOR_ORDERS_DISABLED':
      return l10n.checkoutBlockerMultiVendorDisabled;
    case 'DELIVERY_FEE_UNAVAILABLE':
      return l10n.checkoutBlockerFeeUnavailable;
    case 'PICKUP_SINGLE_VENDOR_ONLY':
      return l10n.checkoutPickupSingleVendorOnly;
    case 'PICKUP_REGISTERED_VENDOR_ONLY':
    case 'BRANCH_PICKUP_DISABLED':
      return l10n.checkoutPickupBranchDisabled;
    case 'BUSINESS_CONFIG_NOT_SET':
      return l10n.serviceTemporarilyUnavailable;
  }

  // `POST /orders` answers 404 when the customer has no active cart left to submit (e.g. a double tap after success).
  if (error.statusCode == 404 && error.code == 'NOT_FOUND') {
    return l10n.checkoutErrorNoActiveCart;
  }

  switch (error.code) {
    case 'NETWORK_ERROR':
      return l10n.errorNetwork;
    case 'TOO_MANY_REQUESTS':
      return l10n.errorTooManyAttempts;
    default:
      return l10n.somethingWentWrong;
  }
}

/// The customer-facing text for one quote blocker, or null when the checkout screen already explains it right where the
/// customer acts (address card, payment section) and repeating it would be noise.
String? checkoutBlockerMessage(BuildContext context, String code) {
  final l10n = AppLocalizations.of(context);
  switch (code) {
    // Explained inline.
    case 'DELIVERY_ADDRESS_REQUIRED':
    case 'ADDRESS_REQUIRED':
    case 'ADDRESS_OUT_OF_SERVICE_AREA':
    case 'VENDOR_DOES_NOT_DELIVER':
    case 'VENDOR_OUTSIDE_DELIVERY_AREA':
    case 'ADDRESS_ZONE_REQUIRED':
    case 'DELIVERY_ZONE_UNAVAILABLE':
    case 'ELECTRONIC_PAYMENT_METHOD_REQUIRED':
    case 'EMPTY_CART':
      return null;
    case 'INSUFFICIENT_INVENTORY':
      return l10n.checkoutErrorInsufficientInventory;
    case 'PRODUCT_UNAVAILABLE':
    case 'BRANCH_UNAVAILABLE':
      return l10n.checkoutBlockerUnavailable;
    case 'MULTI_VENDOR_ORDERS_DISABLED':
      return l10n.checkoutBlockerMultiVendorDisabled;
    case 'DELIVERY_FEE_UNAVAILABLE':
      return l10n.checkoutBlockerFeeUnavailable;
    // A saved GPS address while road-distance pricing is off (Maps disabled): say what to do instead of a generic blocker.
    case 'DISTANCE_PRICING_UNAVAILABLE':
      return l10n.checkoutBlockerGpsUnavailable;
    case 'INVALID_DELIVERY_LOCATION':
    case 'INVALID_DELIVERY_ADDRESS':
      return l10n.checkoutBlockerInvalidAddress;
    case 'PICKUP_SINGLE_VENDOR_ONLY':
      return l10n.checkoutPickupSingleVendorOnly;
    case 'PICKUP_REGISTERED_VENDOR_ONLY':
    case 'BRANCH_PICKUP_DISABLED':
      return l10n.checkoutPickupBranchDisabled;
    case 'WALLET_NOT_ALLOWED_FOR_UNPRICED_ORDER':
    case 'WALLET_NOT_ALLOWED_FOR_WEIGHTED_ORDER':
      return l10n.checkoutWalletUnavailableForOrder;
    case 'MANUAL_TRANSFER_NOT_ALLOWED_FOR_WEIGHTED_ORDER':
      return l10n.checkoutTransferUnavailableWeighed;
    case 'ELECTRONIC_PAYMENT_NOT_ALLOWED_FOR_UNPRICED_ORDER':
      return l10n.checkoutTransferUnavailableUnpriced;
    // Hatly Service: the customer's own place is required (never a Hatly default) — a cart that already holds a request without
    // it is told exactly how to fix it instead of seeing the generic blocker.
    case 'BUY_FROM_PLACE_PICKUP_REQUIRED':
      return l10n.checkoutBlockerAdHocPickupRequired;
    case 'DELIVER_TO_PLACE_DESTINATION_REQUIRED':
    case 'SERVICE_DESTINATION_REQUIRED':
      return l10n.checkoutBlockerAdHocDestinationRequired;
    case 'DELIVER_TO_PLACE_ORIGIN_REQUIRED':
      return l10n.checkoutBlockerAdHocOriginRequired;
    case 'HATLY_DEFAULT_PICKUP_NOT_CONFIGURED':
      return l10n.checkoutBlockerHatlyDefaultPickupMissing;
    case 'HATLY_DEFAULT_DESTINATION_NOT_CONFIGURED':
      return l10n.checkoutBlockerHatlyDefaultDestinationMissing;
    case 'WASALLY_DEFAULT_DESTINATION_NOT_CONFIGURED':
      return l10n.checkoutBlockerWasallyDefaultDestinationMissing;
    case 'ONLINE_PAYMENT_NOT_AVAILABLE':
      return l10n.checkoutErrorOnlinePaymentUnavailable;
    case 'PAYMENT_METHOD_REQUIRED':
      return l10n.checkoutErrorPaymentMethodRequired;
    // A required business setting (e.g. the Hatly Service delivery fee multiplier) is not configured.
    case 'BUSINESS_CONFIG_NOT_SET':
      return l10n.serviceTemporarilyUnavailable;
    default:
      return l10n.checkoutBlockerGeneric;
  }
}
