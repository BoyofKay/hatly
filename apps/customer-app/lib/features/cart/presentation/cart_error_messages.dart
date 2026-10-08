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
    // Standalone Hatly Service (cart.service.ts addAdHocItem). The
    // creation UI (hatly_service_screen.dart) is built to never trigger
    // these by construction (it always collects a place name + service
    // type before submitting, and only ever sends the coordinate pair
    // matching the selected type) — mapped here anyway as a defensive
    // fallback, the same discipline as every other code in this switch.
    case 'AD_HOC_PLACE_NAME_REQUIRED':
      return l10n.cartErrorAdHocPlaceNameRequired;
    case 'AD_HOC_SERVICE_TYPE_REQUIRED':
      return l10n.cartErrorAdHocServiceTypeRequired;
    case 'LOCATION_DOES_NOT_MATCH_SERVICE_TYPE':
      return l10n.cartErrorAdHocLocationMismatch;
    case 'INCOMPLETE_COORDINATE':
      return l10n.cartErrorAdHocIncompleteCoordinate;
    case 'AD_HOC_SERVICE_SINGLE_LOCATION_ONLY':
      return l10n.cartErrorAdHocSingleLocationOnly;
    case 'PICKUP_REGISTERED_VENDOR_ONLY':
      return l10n.cartErrorAdHocPickupOnly;
    // Hatly Service location rule: the backend's own rejection codes
    // (`CheckoutPlannerService.resolveAdHocLocations`) — this creation UI is
    // built to never trigger them by construction (see
    // hatly_service_screen.dart's `_isValid`, which requires the customer's
    // place — pickup for BUY_FROM_PLACE, destination for DELIVER_TO_PLACE —
    // before Continue is even enabled) but they are mapped here anyway as a
    // defensive fallback, same discipline as every other code in this switch.
    case 'DELIVER_TO_PLACE_DESTINATION_REQUIRED':
      return l10n.cartErrorAdHocDestinationRequired;
    case 'BUY_FROM_PLACE_PICKUP_REQUIRED':
      return l10n.cartErrorAdHocPickupRequired;
    // Photos / content of a custom request (Hatly Service and the vendor Custom Request share these backend rules).
    case 'TOO_MANY_IMAGES':
      return l10n.cartErrorTooManyImages;
    case 'INVALID_IMAGE_REFERENCE':
      return l10n.cartErrorInvalidImage;
    case 'CUSTOM_ITEM_CONTENT_REQUIRED':
      return l10n.cartErrorContentRequired;
    // A required business setting is not configured (e.g. the Hatly Service price per kilometre): an honest "not
    // available right now", never the generic error and never the setting's name.
    case 'BUSINESS_CONFIG_NOT_SET':
      return l10n.serviceTemporarilyUnavailable;
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
