import 'package:flutter/widgets.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/network/api_exception.dart';

/// Cart mutation errors carry a specific reason in
/// [ApiException.businessCode] (see cart.service.ts on the backend) —
/// checked first, since "why couldn't this item be added" needs a more
/// specific message than the generic HTTP-status-level mapping in
/// auth_error_messages.dart covers.
String localizedCartErrorMessage(BuildContext context, ApiException error) {
  final l10n = AppLocalizations.of(context);

  switch (error.businessCode) {
    case 'PRODUCT_UNAVAILABLE':
      return l10n.cartErrorProductUnavailable;
    case 'BRANCH_UNAVAILABLE':
      return l10n.cartErrorBranchUnavailable;
    case 'OPTION_REQUIRED':
      return l10n.cartErrorOptionRequired;
    case 'INVALID_OPTION_SELECTION':
      return l10n.cartErrorInvalidOption;
    case 'CART_BRANCH_CONFLICT':
      return l10n.cartBranchConflictMessage;
    // Real cart rules of the multi-vendor cart (cart.service.ts assertCanAddNewGroup).
    case 'MAX_VENDOR_GROUPS_EXCEEDED':
      return l10n.cartErrorMaxVendors;
    case 'PICKUP_SINGLE_VENDOR_ONLY':
      return l10n.cartErrorPickupSingleVendor;
    case 'CATALOG_AD_HOC_MIX_NOT_ALLOWED':
      return l10n.cartErrorMixedCartTypes;
  }

  switch (error.code) {
    case 'NETWORK_ERROR':
      return l10n.errorNetwork;
    default:
      return l10n.somethingWentWrong;
  }
}
