/// Mirrors the real backend `cart-view.interface.ts` field-for-field —
/// CONFIRMED (Cart & Checkout Stabilization): this REPLACES the old
/// flat-`items` model, which predated the "PHASE 3 STEP 3" groups
/// restructuring and no longer matched the real `GET /cart` response
/// at all (every field access below is a direct, verified match
/// against the backend interface, not an assumption).
///
/// Deliberately represents `groupType`/`pricingUnit`/`offerDiscountType`
/// as raw `String`s rather than Dart enums — matches this codebase's
/// own established convention for backend-string fields (see
/// `OrderSummary.status`/`orderStatusLabel()` in the Orders feature),
/// not a new pattern invented here.
library;

class SelectedOptionValue {
  const SelectedOptionValue({
    required this.id,
    required this.name,
    this.nameAr,
    required this.priceDeltaMinor,
  });

  final String id;
  final String name;
  final String? nameAr;
  final int priceDeltaMinor;

  factory SelectedOptionValue.fromJson(Map<String, dynamic> json) {
    return SelectedOptionValue(
      id: json['id'] as String,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
      priceDeltaMinor: json['priceDeltaMinor'] as int,
    );
  }
}

class CartItem {
  const CartItem({
    required this.id,
    this.productId,
    this.productName,
    this.productNameAr,
    this.productImageUrl,
    required this.quantity,
    this.pricingUnit,
    this.requestedWeightGrams,
    this.inventoryMode,
    this.availableQuantity,
    this.notes,
    required this.selectedOptionValues,
    this.unitPriceMinor,
    this.lineTotalMinor,
    required this.isAvailable,
    this.freeTextDescription,
    required this.imageUrls,
    this.offerId,
    this.offerDiscountType,
    this.offerDiscountValue,
    this.offerDiscountedQuantity,
    this.offerDiscountAmountMinor,
    this.offerMechanism,
    this.specialPriceMinor,
    this.payableLineTotalMinor,
  });

  final String id;
  final String? productId;
  final String? productName;
  final String? productNameAr;
  final String? productImageUrl;
  final int quantity;

  /// `'PIECE'` / `'WEIGHT'` / null (an AD_HOC_SERVICE item has no
  /// pricing unit at all — see the backend interface's own comment).
  final String? pricingUnit;

  /// WEIGHT items only — integer grams, never overloaded onto [quantity].
  final int? requestedWeightGrams;

  /// Tracked Inventory Order-Time Enforcement. Live product state
  /// (not a snapshot) — `'OPEN'`/`'TRACKED'`/null (AD_HOC_SERVICE
  /// item). `availableQuantity` is pieces for a PIECE product, grams
  /// for WEIGHT (same units as [requestedWeightGrams]) — used ONLY as
  /// a Cart UX guard; the backend remains authoritative at Order
  /// creation regardless of this value.
  final String? inventoryMode;
  final int? availableQuantity;

  final String? notes;
  final List<SelectedOptionValue> selectedOptionValues;

  /// Null for an AD_HOC_SERVICE item (no formula exists to price it).
  /// For a WEIGHT item, this is the price PER KILOGRAM — never a
  /// per-piece price for that item type.
  final int? unitPriceMinor;
  final int? lineTotalMinor;

  final bool isAvailable;

  /// AD_HOC_SERVICE items only.
  final String? freeTextDescription;
  final List<String> imageUrls;

  /// Offers preview (server-computed, best-effort — see the backend
  /// interface's own comment). Null for a WEIGHT item, an
  /// AD_HOC_SERVICE item, or when no Offer applies. Flutter only ever
  /// DISPLAYS these — never recomputes a discount itself.
  final String? offerId;
  final String? offerDiscountType;
  final int? offerDiscountValue;
  final int? offerDiscountedQuantity;
  final int? offerDiscountAmountMinor;

  /// Customer Offers Integration. Unambiguous discriminator — CONFIRMED
  /// added because [offerDiscountType]/[offerDiscountValue] above no
  /// longer cleanly represent a Flash Sale's real special price after
  /// the backend's mechanism split. `'FLASH_SALE'` or null.
  final String? offerMechanism;

  /// FLASH_SALE only — the real replacement price. Null otherwise.
  final int? specialPriceMinor;

  bool get hasOfferPreview => offerId != null;
  bool get hasFlashSale => offerMechanism == 'FLASH_SALE';
  final int? payableLineTotalMinor;

  bool get isWeighted => pricingUnit == 'WEIGHT';
  bool get isAdHoc => productId == null;
  bool get isTracked => inventoryMode == 'TRACKED';

  factory CartItem.fromJson(Map<String, dynamic> json) {
    return CartItem(
      id: json['id'] as String,
      productId: json['productId'] as String?,
      productName: json['productName'] as String?,
      productNameAr: json['productNameAr'] as String?,
      productImageUrl: json['productImageUrl'] as String?,
      quantity: json['quantity'] as int,
      pricingUnit: json['pricingUnit'] as String?,
      requestedWeightGrams: json['requestedWeightGrams'] as int?,
      inventoryMode: json['inventoryMode'] as String?,
      availableQuantity: json['availableQuantity'] as int?,
      notes: json['notes'] as String?,
      selectedOptionValues: (json['selectedOptionValues'] as List)
          .map((e) => SelectedOptionValue.fromJson(e as Map<String, dynamic>))
          .toList(),
      unitPriceMinor: json['unitPriceMinor'] as int?,
      lineTotalMinor: json['lineTotalMinor'] as int?,
      isAvailable: json['isAvailable'] as bool,
      freeTextDescription: json['freeTextDescription'] as String?,
      imageUrls:
          (json['imageUrls'] as List? ?? []).map((e) => e as String).toList(),
      offerId: json['offerId'] as String?,
      offerDiscountType: json['offerDiscountType'] as String?,
      offerDiscountValue: json['offerDiscountValue'] as int?,
      offerDiscountedQuantity: json['offerDiscountedQuantity'] as int?,
      offerDiscountAmountMinor: json['offerDiscountAmountMinor'] as int?,
      offerMechanism: json['offerMechanism'] as String?,
      specialPriceMinor: json['specialPriceMinor'] as int?,
      payableLineTotalMinor: json['payableLineTotalMinor'] as int?,
    );
  }
}

class CartGroup {
  const CartGroup({
    required this.id,
    required this.groupType,
    this.vendorBranchId,
    this.vendorName,
    this.adHocPlaceName,
    this.adHocServiceType,
    this.adHocPickupLatitude,
    this.adHocPickupLongitude,
    this.adHocDestinationLatitude,
    this.adHocDestinationLongitude,
    this.adHocPickupLabel,
    this.adHocDestinationLabel,
    this.vendorNote,
    required this.items,
    this.subtotalMinor,
    this.hasSubtotalDiscountOffer = false,
  });

  final String id;

  /// `'CATALOG'` or `'AD_HOC_SERVICE'`.
  final String groupType;
  final String? vendorBranchId;
  final String? vendorName;
  final String? adHocPlaceName;
  final String? adHocServiceType;
  final double? adHocPickupLatitude;
  final double? adHocPickupLongitude;
  final double? adHocDestinationLatitude;
  final double? adHocDestinationLongitude;

  /// Labels of the origin / destination the CUSTOMER chose (null = the configured default is used).
  final String? adHocPickupLabel;
  final String? adHocDestinationLabel;
  final String? vendorNote;
  final List<CartItem> items;

  /// Null for an AD_HOC_SERVICE group — never fabricated as 0 (see the
  /// backend interface's own comment).
  final int? subtotalMinor;

  /// Customer Offers Integration. Segment-level, non-authoritative
  /// signal — CONFIRMED never a computed discount amount (the real
  /// amount is only known authoritatively at checkout). Always false
  /// for an AD_HOC_SERVICE group.
  final bool hasSubtotalDiscountOffer;

  bool get isAdHocService => groupType == 'AD_HOC_SERVICE';

  /// "وصّلي لمكان" (Wasally): no product at all — the customer pays the DELIVERY FEE only. (Hatly's "هاتلي من مكان" is the
  /// other ad-hoc type: its purchase price is pending until bought.)
  bool get isDeliveryOnly =>
      isAdHocService && adHocServiceType == 'DELIVER_TO_PLACE';

  factory CartGroup.fromJson(Map<String, dynamic> json) {
    return CartGroup(
      id: json['id'] as String,
      groupType: json['groupType'] as String,
      vendorBranchId: json['vendorBranchId'] as String?,
      vendorName: json['vendorName'] as String?,
      adHocPlaceName: json['adHocPlaceName'] as String?,
      adHocServiceType: json['adHocServiceType'] as String?,
      adHocPickupLatitude: (json['adHocPickupLatitude'] as num?)?.toDouble(),
      adHocPickupLongitude: (json['adHocPickupLongitude'] as num?)?.toDouble(),
      adHocDestinationLatitude:
          (json['adHocDestinationLatitude'] as num?)?.toDouble(),
      adHocDestinationLongitude:
          (json['adHocDestinationLongitude'] as num?)?.toDouble(),
      adHocPickupLabel: json['adHocPickupLabel'] as String?,
      adHocDestinationLabel: json['adHocDestinationLabel'] as String?,
      vendorNote: json['vendorNote'] as String?,
      items: (json['items'] as List)
          .map((e) => CartItem.fromJson(e as Map<String, dynamic>))
          .toList(),
      subtotalMinor: json['subtotalMinor'] as int?,
      hasSubtotalDiscountOffer:
          json['hasSubtotalDiscountOffer'] as bool? ?? false,
    );
  }
}

class Cart {
  const Cart({
    required this.id,
    required this.fulfillmentType,
    this.orderNote,
    required this.groups,
    required this.subtotalMinor,
    required this.hasUnpricedItems,
    required this.readyForCheckout,
  });

  final String id;

  /// `'DELIVERY'` or `'PICKUP'`.
  final String fulfillmentType;
  final String? orderNote;
  final List<CartGroup> groups;

  /// Sum of CATALOG groups' subtotals only.
  final int subtotalMinor;

  /// True if any group is AD_HOC_SERVICE.
  final bool hasUnpricedItems;
  final bool readyForCheckout;

  /// What a GUEST has: nothing. No cart exists for a visitor without an account (and none is created or fetched).
  static const empty = Cart(
      id: '',
      fulfillmentType: 'DELIVERY',
      groups: [],
      subtotalMinor: 0,
      hasUnpricedItems: false,
      readyForCheckout: false);

  /// Every group is a delivery-only service: there is no merchandise subtotal to show, only the delivery fee.
  bool get isDeliveryOnly =>
      groups.isNotEmpty && groups.every((g) => g.isDeliveryOnly);

  int get itemCount => groups.fold(
      0, (sum, g) => sum + g.items.fold(0, (s, i) => s + i.quantity));
  bool get isEmpty => groups.every((g) => g.items.isEmpty);

  factory Cart.fromJson(Map<String, dynamic> json) {
    return Cart(
      id: json['id'] as String,
      fulfillmentType: json['fulfillmentType'] as String,
      orderNote: json['orderNote'] as String?,
      groups: (json['groups'] as List)
          .map((e) => CartGroup.fromJson(e as Map<String, dynamic>))
          .toList(),
      subtotalMinor: json['subtotalMinor'] as int,
      hasUnpricedItems: json['hasUnpricedItems'] as bool,
      readyForCheckout: json['readyForCheckout'] as bool,
    );
  }
}
