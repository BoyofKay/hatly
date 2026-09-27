import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../cart/data/cart_providers.dart';
import '../../../cart/presentation/cart_error_messages.dart';
import '../../data/home_demo_content.dart';
import '../../domain/home_content.dart';

/// Existing routes only — Home adds no navigation of its own.
String productRoute(String? id) =>
    id == null || isDemoId(id) ? '/search' : '/products/$id';
String vendorRoute(String? id) =>
    id == null || isDemoId(id) ? '/vendors' : '/vendors/$id';

/// Where an Offers-row card leads.
String offerRoute(HomeOffer offer) {
  switch (offer.kind) {
    case HomeOfferKind.product:
    case HomeOfferKind.flash:
      return productRoute(offer.targetId);
    case HomeOfferKind.vendor:
    case HomeOfferKind.freeDelivery:
    case HomeOfferKind.bundle:
      return vendorRoute(offer.targetId);
  }
}

/// Where a promo CTA leads (the "Add to cart" product CTA is handled
/// separately, see [handlePromoAction]; this is its fallback destination).
String promoRoute(HomePromo promo) {
  switch (promo.kind) {
    case HomePromoKind.product:
    case HomePromoKind.offer:
      return productRoute(promo.targetId);
    case HomePromoKind.vendor:
    case HomePromoKind.freeDelivery:
    case HomePromoKind.bundle:
      return vendorRoute(promo.targetId);
  }
}

/// Business codes on which a one-tap add cannot complete and the customer must
/// choose something first (options / weight) or resolve a cart conflict — the
/// product page already owns those flows, so we hand off to it.
const _needsProductPage = {
  'CART_BRANCH_CONFLICT',
  'OPTION_REQUIRED',
  'REQUESTED_WEIGHT_GRAMS_REQUIRED',
  'INVALID_OPTION_SELECTION'
};

/// One-tap "+" on a product card / product promo CTA: adds ONE unit through the
/// existing cart controller (the same API the product page uses). When a single
/// tap cannot complete (options / weight required, cart-branch conflict) the
/// product page — which already owns those flows — is opened instead. Demo
/// products (no real product behind them) never touch the cart.
Future<void> handleQuickAdd(
    BuildContext context, WidgetRef ref, String productId) async {
  if (isDemoId(productId)) {
    context.push(productRoute(productId));
    return;
  }

  final l10n = AppLocalizations.of(context);
  final messenger = ScaffoldMessenger.of(context);
  final router = GoRouter.of(context);

  final error = await ref
      .read(cartControllerProvider.notifier)
      .addItem(productId: productId, quantity: 1);
  if (error == null) {
    messenger
        .showSnackBar(SnackBar(content: Text(l10n.addedToCartConfirmation)));
    return;
  }
  if (_needsProductPage.contains(error.businessCode)) {
    router.push(productRoute(productId));
    return;
  }
  if (context.mounted) {
    messenger.showSnackBar(
        SnackBar(content: Text(localizedCartErrorMessage(context, error))));
  }
}

/// Whether an Offers-row card can offer the floating "+" (a real product).
bool offerIsQuickAddable(HomeOffer offer) =>
    (offer.kind == HomeOfferKind.product ||
        offer.kind == HomeOfferKind.flash) &&
    offer.targetId != null &&
    !offer.isDemo &&
    !isDemoId(offer.targetId);

/// CTA action. Product promos add one unit (see [handleQuickAdd]); everything
/// else navigates. Demo promos never touch the cart.
Future<void> handlePromoAction(
    BuildContext context, WidgetRef ref, HomePromo promo) async {
  final target = promo.targetId;
  if (promo.kind != HomePromoKind.product ||
      target == null ||
      promo.isDemo ||
      isDemoId(target)) {
    context.push(promoRoute(promo));
    return;
  }
  await handleQuickAdd(context, ref, target);
}
