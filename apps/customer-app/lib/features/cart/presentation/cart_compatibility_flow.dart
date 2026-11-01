import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../data/cart_providers.dart';
import '../domain/cart_compatibility.dart';

/// The customer-facing sentence for a server compatibility code. The wording for the codes `POST /cart/items` already answers with is reused;
/// anything the app does not know falls back to the server's own message (never a blank dialog).
String localizedCompatibilityMessage(AppLocalizations l10n, CartCompatibility c) {
  switch (c.code) {
    case 'PRODUCT_UNAVAILABLE':
      return l10n.cartErrorProductUnavailable;
    case 'BRANCH_UNAVAILABLE':
      return l10n.cartErrorBranchUnavailable;
    case 'MAX_VENDOR_GROUPS_EXCEEDED':
      return l10n.cartErrorMaxVendors;
    case 'PICKUP_SINGLE_VENDOR_ONLY':
      return l10n.cartErrorPickupSingleVendor;
    case 'CATALOG_AD_HOC_MIX_NOT_ALLOWED':
      return l10n.cartErrorMixedCartTypes;
    case 'MULTI_VENDOR_DISABLED':
      return l10n.cartCompatMultiVendorDisabled;
    case 'BRANCH_PICKUP_DISABLED':
      return l10n.cartCompatBranchPickupDisabled;
    default:
      return c.message ?? l10n.cartCompatTitle;
  }
}

/// Call BEFORE adding a product. Returns true when the product can go in the cart — either it fits as it is, or the customer chose the
/// way out the server offered (switch to delivery / start a new cart) and it worked. Returns false when the customer keeps their cart or
/// there is nothing they can do (the dialog says why). If the server cannot be asked, returns true: the add itself is still validated by the
/// server, so nothing can slip through — the customer just learns about a conflict one step later.
Future<bool> ensureCartCompatible(BuildContext context, WidgetRef ref, String productId) async {
  final controller = ref.read(cartControllerProvider.notifier);
  final verdict = await controller.checkAdd(productId);
  if (verdict == null || verdict.compatible) return true;
  if (!context.mounted) return false;

  final l10n = AppLocalizations.of(context);
  final resolution = verdict.resolution;
  final choice = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      key: const Key('cart-compat-dialog'),
      title: Text(l10n.cartCompatTitle),
      content: Text(localizedCompatibilityMessage(l10n, verdict)),
      actions: [
        TextButton(
          key: const Key('cart-compat-keep'),
          onPressed: () => Navigator.of(ctx).pop(false),
          child: Text(resolution == null ? l10n.cartCompatOk : l10n.cartCompatKeepCart),
        ),
        if (resolution != null)
          FilledButton(
            key: const Key('cart-compat-resolve'),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(resolution == 'SWITCH_TO_DELIVERY' ? l10n.cartCompatSwitchToDelivery : l10n.cartCompatStartNewCart),
          ),
      ],
    ),
  );
  if (choice != true) return false;

  final error = resolution == 'SWITCH_TO_DELIVERY' ? await controller.setFulfillmentType('DELIVERY') : await controller.clearCart();
  if (error != null) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    return false;
  }
  return true;
}
