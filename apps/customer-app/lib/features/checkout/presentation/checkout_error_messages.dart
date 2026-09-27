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
    case 'PRODUCT_UNAVAILABLE':
    case 'BRANCH_UNAVAILABLE':
      return l10n.checkoutBlockerUnavailable;
  }

  switch (error.code) {
    case 'NETWORK_ERROR':
      return l10n.errorNetwork;
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
    default:
      return l10n.checkoutBlockerGeneric;
  }
}
