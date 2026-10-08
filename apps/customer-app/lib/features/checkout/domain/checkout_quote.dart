/// Mirrors `POST /checkout/quote` (see backend `CheckoutQuoteService.assemble`). Everything here is server-authoritative:
/// the app displays these amounts and never recomputes a fee, a discount, an ETA or a payment split itself.
library;

import '../../addresses/domain/delivery_zone.dart';

/// A reason the order cannot be placed right now (machine-readable [code], server-written [message]).
class QuoteBlocker {
  const QuoteBlocker({required this.code, required this.message});

  final String code;
  final String message;

  factory QuoteBlocker.fromJson(Map<String, dynamic> json) => QuoteBlocker(
        code: json['code'] as String,
        message: (json['message'] as String?) ?? json['code'] as String,
      );
}

class QuotePickupBranch {
  const QuotePickupBranch({
    required this.vendorBranchId,
    required this.name,
    required this.address,
  });

  final String vendorBranchId;
  final String? name;
  final String? address;

  factory QuotePickupBranch.fromJson(Map<String, dynamic> json) =>
      QuotePickupBranch(
        vendorBranchId: json['vendorBranchId'] as String,
        name: json['name'] as String?,
        address: json['address'] as String?,
      );
}

class QuoteFulfillment {
  const QuoteFulfillment({
    required this.type,
    required this.pickupAvailable,
    this.pickupUnavailableReason,
    this.pickupBranch,
  });

  final String type;
  final bool pickupAvailable;
  final String? pickupUnavailableReason;
  final QuotePickupBranch? pickupBranch;

  bool get isPickup => type == 'PICKUP';

  factory QuoteFulfillment.fromJson(Map<String, dynamic> json) =>
      QuoteFulfillment(
        type: json['type'] as String,
        pickupAvailable: json['pickupAvailable'] as bool? ?? false,
        pickupUnavailableReason: json['pickupUnavailableReason'] as String?,
        pickupBranch: json['pickupBranch'] is Map<String, dynamic>
            ? QuotePickupBranch.fromJson(
                json['pickupBranch'] as Map<String, dynamic>)
            : null,
      );
}

/// The address the quote was computed for: the customer's explicit choice, or their default when it is serviceable.
class QuoteAddress {
  const QuoteAddress({
    required this.addressId,
    required this.source,
    required this.snapshot,
  });

  final String? addressId;

  /// `REQUEST` · `DEFAULT` · null (none yet).
  final String? source;
  final QuoteAddressSnapshot? snapshot;

  factory QuoteAddress.fromJson(Map<String, dynamic> json) => QuoteAddress(
        addressId: json['addressId'] as String?,
        source: json['source'] as String?,
        snapshot: json['snapshot'] is Map<String, dynamic>
            ? QuoteAddressSnapshot.fromJson(
                json['snapshot'] as Map<String, dynamic>)
            : null,
      );
}

/// The address as it would be frozen on the order (also the shape of an order's immutable address snapshot). PD-009: the pin
/// is optional; [deliveryZone] is the zone exactly as frozen (an order keeps its zone name even if the zone is renamed later).
class QuoteAddressSnapshot {
  const QuoteAddressSnapshot({
    this.label,
    required this.line1,
    this.latitude,
    this.longitude,
    this.deliveryZone,
    this.instructions,
    this.governorate,
    this.city,
    this.street,
    this.buildingNumber,
    this.floor,
    this.apartment,
    this.landmark,
    this.formattedAddress,
  });

  final String? label;
  final String line1;
  final double? latitude;
  final double? longitude;
  final DeliveryZone? deliveryZone;
  final String? instructions;
  final String? governorate;
  final String? city;
  final String? street;
  final String? buildingNumber;
  final String? floor;
  final String? apartment;
  final String? landmark;
  final String? formattedAddress;

  /// "بلبيس — أبو نصيب" when the address has a zone, else null (an order placed before zones existed).
  String? areaLabel(bool arabic) => deliveryZone?.areaLabel(arabic);

  /// The structured, human-readable lines a customer expects to see (street/building/floor/apartment, city, governorate).
  /// With a zone the area line ("بلبيس — أبو نصيب") comes first and replaces the plain city/governorate line.
  List<String> detailLinesFor(bool arabic) {
    final area = areaLabel(arabic);
    if (area == null) return detailLines;
    final unit = [
      if (buildingNumber?.isNotEmpty == true) buildingNumber!,
      if (floor?.isNotEmpty == true) floor!,
      if (apartment?.isNotEmpty == true) apartment!,
    ];
    return [
      area,
      line1,
      if (unit.isNotEmpty) unit.join(' · '),
      if (landmark?.isNotEmpty == true) landmark!,
    ].where((l) => l.isNotEmpty).toList();
  }

  List<String> get detailLines {
    final unit = [
      if (buildingNumber?.isNotEmpty == true) buildingNumber!,
      if (floor?.isNotEmpty == true) floor!,
      if (apartment?.isNotEmpty == true) apartment!,
    ];
    return [
      line1,
      if (unit.isNotEmpty) unit.join(' · '),
      if (landmark?.isNotEmpty == true) landmark!,
      [
        if (city?.isNotEmpty == true) city!,
        if (governorate?.isNotEmpty == true) governorate!,
      ].join('، '),
    ].where((l) => l.isNotEmpty).toList();
  }

  factory QuoteAddressSnapshot.fromJson(Map<String, dynamic> json) =>
      QuoteAddressSnapshot(
        label: json['label'] as String?,
        line1: json['line1'] as String,
        latitude: (json['latitude'] as num?)?.toDouble(),
        longitude: (json['longitude'] as num?)?.toDouble(),
        deliveryZone: json['deliveryZone'] is Map<String, dynamic>
            ? DeliveryZone.fromJson(json['deliveryZone'] as Map<String, dynamic>)
            : null,
        instructions: json['instructions'] as String?,
        governorate: json['governorate'] as String?,
        city: json['city'] as String?,
        street: json['street'] as String?,
        buildingNumber: json['buildingNumber'] as String?,
        floor: json['floor'] as String?,
        apartment: json['apartment'] as String?,
        landmark: json['landmark'] as String?,
        formattedAddress: json['formattedAddress'] as String?,
      );
}

class QuoteEligibility {
  const QuoteEligibility({
    required this.serviceable,
    this.code,
    this.message,
    this.pricingSource,
  });

  final bool serviceable;
  final String? code;
  final String? message;

  /// `DISTANCE` (map pin) · `DELIVERY_ZONE` (no pin — the selected zone) · null.
  final String? pricingSource;

  factory QuoteEligibility.fromJson(Map<String, dynamic> json) =>
      QuoteEligibility(
        serviceable: json['serviceable'] as bool? ?? false,
        code: json['code'] as String?,
        message: json['message'] as String?,
        pricingSource: json['pricingSource'] as String?,
      );
}

class QuoteSummary {
  const QuoteSummary({
    required this.subtotalMinor,
    required this.discountMinor,
    required this.deliveryFeeMinor,
    required this.totalMinor,
    required this.walletAppliedMinor,
    required this.amountDueMinor,
  });

  final int subtotalMinor;
  final int discountMinor;

  /// Null until a fee can be quoted (no address yet, or nothing deliverable).
  final int? deliveryFeeMinor;
  final int? totalMinor;
  final int walletAppliedMinor;
  final int? amountDueMinor;

  factory QuoteSummary.fromJson(Map<String, dynamic> json) => QuoteSummary(
        subtotalMinor: (json['subtotalMinor'] as num).toInt(),
        discountMinor: (json['discountMinor'] as num?)?.toInt() ?? 0,
        deliveryFeeMinor: (json['deliveryFeeMinor'] as num?)?.toInt(),
        totalMinor: (json['totalMinor'] as num?)?.toInt(),
        walletAppliedMinor: (json['walletAppliedMinor'] as num?)?.toInt() ?? 0,
        amountDueMinor: (json['amountDueMinor'] as num?)?.toInt(),
      );
}

class QuoteEta {
  const QuoteEta({
    required this.available,
    this.reason,
    this.preparationMinutes,
    this.travelMinutes,
    this.estimatedMinutes,
    this.rangeMinMinutes,
    this.rangeMaxMinutes,
  });

  final bool available;
  final String? reason;
  final int? preparationMinutes;
  final int? travelMinutes;
  final int? estimatedMinutes;
  final int? rangeMinMinutes;
  final int? rangeMaxMinutes;

  factory QuoteEta.fromJson(Map<String, dynamic> json) => QuoteEta(
        available: json['available'] as bool? ?? false,
        reason: json['reason'] as String?,
        preparationMinutes: (json['preparationMinutes'] as num?)?.toInt(),
        travelMinutes: (json['travelMinutes'] as num?)?.toInt(),
        estimatedMinutes: (json['estimatedMinutes'] as num?)?.toInt(),
        rangeMinMinutes: (json['rangeMinMinutes'] as num?)?.toInt(),
        rangeMaxMinutes: (json['rangeMaxMinutes'] as num?)?.toInt(),
      );
}

class QuoteDeliveryVendor {
  const QuoteDeliveryVendor({
    required this.vendorBranchId,
    this.name,
    this.distanceToCustomerMeters,
  });

  final String vendorBranchId;
  final String? name;

  /// Null when the fee came from a Delivery Zone (no distance was measured).
  final int? distanceToCustomerMeters;

  factory QuoteDeliveryVendor.fromJson(Map<String, dynamic> json) =>
      QuoteDeliveryVendor(
        vendorBranchId: json['vendorBranchId'] as String,
        name: json['name'] as String?,
        distanceToCustomerMeters:
            (json['distanceToCustomerMeters'] as num?)?.toInt(),
      );
}

/// The delivery fee and how it is made up. Any part may be null when the fee has no registered-vendor breakdown
/// (e.g. an ad-hoc service fee) — the UI then shows only the overall fee.
class QuoteDelivery {
  const QuoteDelivery({
    required this.applicable,
    required this.source,
    this.feeMinor,
    this.baseFeeMinor,
    this.additionalVendorFeeMinor,
    this.additionalVendorChargeMinor,
    required this.vendorCount,
    this.distanceMeters,
    required this.vendors,
    required this.eta,
    this.pricingSource,
    this.deliveryZone,
    this.hatlyService,
  });

  /// `DISTANCE` · `DELIVERY_ZONE` · null (not priced yet).
  final String? pricingSource;

  /// The zone the fee was priced for (frozen into the order when placed).
  final DeliveryZone? deliveryZone;

  /// Hatly Service only: the fee is [QuoteHatlyServiceFee.zoneDeliveryFeeMinor] × [QuoteHatlyServiceFee.multiplier].
  final QuoteHatlyServiceFee? hatlyService;

  bool get pricedByZone => pricingSource == 'DELIVERY_ZONE';

  final bool applicable;
  final String source;
  final int? feeMinor;
  final int? baseFeeMinor;
  final int? additionalVendorFeeMinor;
  final int? additionalVendorChargeMinor;
  final int vendorCount;
  final int? distanceMeters;
  final List<QuoteDeliveryVendor> vendors;
  final QuoteEta eta;

  bool get hasBreakdown => baseFeeMinor != null;

  factory QuoteDelivery.fromJson(Map<String, dynamic> json) => QuoteDelivery(
        applicable: json['applicable'] as bool? ?? false,
        source: (json['source'] as String?) ?? 'NONE',
        feeMinor: (json['feeMinor'] as num?)?.toInt(),
        baseFeeMinor: (json['baseFeeMinor'] as num?)?.toInt(),
        additionalVendorFeeMinor:
            (json['additionalVendorFeeMinor'] as num?)?.toInt(),
        additionalVendorChargeMinor:
            (json['additionalVendorChargeMinor'] as num?)?.toInt(),
        vendorCount: (json['vendorCount'] as num?)?.toInt() ?? 0,
        distanceMeters: (json['distanceMeters'] as num?)?.toInt(),
        vendors: (json['vendors'] as List? ?? [])
            .map((e) => QuoteDeliveryVendor.fromJson(e as Map<String, dynamic>))
            .toList(),
        eta: QuoteEta.fromJson(json['eta'] as Map<String, dynamic>),
        pricingSource: json['pricingSource'] as String?,
        deliveryZone: json['deliveryZone'] is Map<String, dynamic>
            ? DeliveryZone.fromJson(json['deliveryZone'] as Map<String, dynamic>)
            : null,
        hatlyService: json['hatlyService'] is Map<String, dynamic>
            ? QuoteHatlyServiceFee.fromJson(json['hatlyService'] as Map<String, dynamic>)
            : null,
      );
}

/// The two server-computed parts of a Hatly Service delivery fee (PD-009 amended: the selected area's delivery fee × the
/// multiplier, pin or not) — shown, never recomputed by the app.
class QuoteHatlyServiceFee {
  const QuoteHatlyServiceFee({required this.zoneDeliveryFeeMinor, required this.multiplier});

  final int zoneDeliveryFeeMinor;
  final double multiplier;

  /// "1.5" — never "1.50000".
  String get multiplierText {
    final fixed = multiplier.toStringAsFixed(4);
    return fixed.replaceFirst(RegExp(r'\.?0+$'), '');
  }

  factory QuoteHatlyServiceFee.fromJson(Map<String, dynamic> json) => QuoteHatlyServiceFee(
        zoneDeliveryFeeMinor: (json['zoneDeliveryFeeMinor'] as num).toInt(),
        multiplier: (json['multiplier'] as num).toDouble(),
      );
}

class QuoteVendor {
  const QuoteVendor({
    this.vendorBranchId,
    this.name,
    required this.subtotalMinor,
    required this.discountMinor,
    required this.itemCount,
    this.preparationMinutes,
    required this.couponApplied,
  });

  final String? vendorBranchId;
  final String? name;
  final int subtotalMinor;
  final int discountMinor;
  final int itemCount;

  /// The branch's configured preparation time — null when the vendor has not configured one.
  final int? preparationMinutes;
  final bool couponApplied;

  factory QuoteVendor.fromJson(Map<String, dynamic> json) => QuoteVendor(
        vendorBranchId: json['vendorBranchId'] as String?,
        name: json['name'] as String?,
        subtotalMinor: (json['subtotalMinor'] as num?)?.toInt() ?? 0,
        discountMinor: (json['discountMinor'] as num?)?.toInt() ?? 0,
        itemCount: (json['itemCount'] as num?)?.toInt() ?? 0,
        preparationMinutes: (json['preparationMinutes'] as num?)?.toInt(),
        couponApplied: json['couponApplied'] as bool? ?? false,
      );
}

/// `NONE` · `APPLIED` · `REJECTED`.
class QuoteCoupon {
  const QuoteCoupon({
    required this.status,
    this.code,
    this.discountMinor,
    this.vendorName,
    this.reasonCode,
    this.message,
  });

  final String status;
  final String? code;
  final int? discountMinor;
  final String? vendorName;
  final String? reasonCode;
  final String? message;

  bool get isApplied => status == 'APPLIED';
  bool get isRejected => status == 'REJECTED';

  factory QuoteCoupon.fromJson(Map<String, dynamic> json) => QuoteCoupon(
        status: (json['status'] as String?) ?? 'NONE',
        code: json['code'] as String?,
        discountMinor: (json['discountMinor'] as num?)?.toInt(),
        vendorName: json['vendorName'] as String?,
        reasonCode: json['reasonCode'] as String?,
        message: json['message'] as String?,
      );
}

class QuoteWallet {
  const QuoteWallet({
    required this.balanceMinor,
    required this.appliedMinor,
    required this.available,
  });

  final int balanceMinor;
  final int appliedMinor;
  final bool available;

  factory QuoteWallet.fromJson(Map<String, dynamic> json) => QuoteWallet(
        balanceMinor: (json['balanceMinor'] as num?)?.toInt() ?? 0,
        appliedMinor: (json['appliedMinor'] as num?)?.toInt() ?? 0,
        available: json['available'] as bool? ?? false,
      );
}

class QuotePaymentOptions {
  const QuotePaymentOptions({
    required this.cod,
    required this.payAtDelivery,
    required this.manualTransferAvailable,
    this.manualTransferReason,
    required this.electronicMethods,
  });

  final bool cod;
  final bool payAtDelivery;
  final bool manualTransferAvailable;

  /// Why Manual Transfer is unavailable: `NOT_CONFIGURED` · `WEIGHED_ITEMS` · `UNPRICED_ORDER`.
  final String? manualTransferReason;

  /// The electronic methods the server currently offers (a BusinessConfig decision), in display order.
  final List<String> electronicMethods;

  factory QuotePaymentOptions.fromJson(Map<String, dynamic> json) {
    final transfer = (json['manualTransfer'] as Map<String, dynamic>?) ?? {};
    return QuotePaymentOptions(
      cod: json['cod'] as bool? ?? true,
      payAtDelivery: json['payAtDelivery'] as bool? ?? false,
      manualTransferAvailable: transfer['available'] as bool? ?? false,
      manualTransferReason: transfer['reason'] as String?,
      electronicMethods: (json['electronicMethods'] as List? ?? [])
          .map((e) => e as String)
          .toList(),
    );
  }
}

class QuotePayment {
  const QuotePayment({
    this.method,
    this.electronicMethod,
    required this.awaitsPaymentApproval,
    required this.wallet,
    required this.options,
  });

  /// The method the order would be placed with — `WALLET` when the wallet alone covers the total.
  final String? method;
  final String? electronicMethod;
  final bool awaitsPaymentApproval;
  final QuoteWallet wallet;
  final QuotePaymentOptions options;

  factory QuotePayment.fromJson(Map<String, dynamic> json) {
    final selected = (json['selected'] as Map<String, dynamic>?) ?? {};
    return QuotePayment(
      method: selected['method'] as String?,
      electronicMethod: selected['electronicMethod'] as String?,
      awaitsPaymentApproval: json['awaitsPaymentApproval'] as bool? ?? false,
      wallet: QuoteWallet.fromJson((json['wallet'] as Map<String, dynamic>?) ??
          const {'balanceMinor': 0, 'appliedMinor': 0, 'available': false}),
      options: QuotePaymentOptions.fromJson(
          (json['options'] as Map<String, dynamic>?) ?? const {}),
    );
  }
}

class CheckoutQuote {
  const CheckoutQuote({
    required this.canPlaceOrder,
    this.hasPendingPricing = false,
    required this.blockers,
    this.fulfillment,
    this.address,
    this.eligibility,
    this.summary,
    this.delivery,
    required this.vendors,
    required this.coupon,
    this.payment,
    this.quoteToken,
    this.expiresAt,
  });

  final bool canPlaceOrder;

  /// Explicit server flag: a Hatly Service request has no confirmed price yet. The total / amount due are then unknown (never 0),
  /// the order is cash-on-delivery only, and the price is confirmed while the order is being prepared.
  final bool hasPendingPricing;
  final List<QuoteBlocker> blockers;
  final QuoteFulfillment? fulfillment;
  final QuoteAddress? address;
  final QuoteEligibility? eligibility;
  final QuoteSummary? summary;
  final QuoteDelivery? delivery;
  final List<QuoteVendor> vendors;
  final QuoteCoupon coupon;
  final QuotePayment? payment;

  /// Freezes the delivery fee for the inputs this quote was made for; sent back when the order is placed.
  final String? quoteToken;
  final DateTime? expiresAt;

  bool hasBlocker(String code) => blockers.any((b) => b.code == code);

  /// An empty cart short-circuits the server quote (only `canPlaceOrder` + one blocker come back).
  bool get isEmptyCart => hasBlocker('EMPTY_CART');

  factory CheckoutQuote.fromJson(Map<String, dynamic> json) {
    Map<String, dynamic>? map(String key) => json[key] is Map<String, dynamic>
        ? json[key] as Map<String, dynamic>
        : null;
    return CheckoutQuote(
      canPlaceOrder: json['canPlaceOrder'] as bool? ?? false,
      hasPendingPricing: json['hasPendingPricing'] as bool? ?? false,
      blockers: (json['blockers'] as List? ?? [])
          .map((e) => QuoteBlocker.fromJson(e as Map<String, dynamic>))
          .toList(),
      fulfillment: map('fulfillment') == null
          ? null
          : QuoteFulfillment.fromJson(map('fulfillment')!),
      address: map('address') == null
          ? null
          : QuoteAddress.fromJson(map('address')!),
      eligibility: map('eligibility') == null
          ? null
          : QuoteEligibility.fromJson(map('eligibility')!),
      summary: map('summary') == null
          ? null
          : QuoteSummary.fromJson(map('summary')!),
      delivery: map('delivery') == null
          ? null
          : QuoteDelivery.fromJson(map('delivery')!),
      vendors: (json['vendors'] as List? ?? [])
          .map((e) => QuoteVendor.fromJson(e as Map<String, dynamic>))
          .toList(),
      coupon: map('coupon') == null
          ? const QuoteCoupon(status: 'NONE')
          : QuoteCoupon.fromJson(map('coupon')!),
      payment: map('payment') == null
          ? null
          : QuotePayment.fromJson(map('payment')!),
      quoteToken: json['quoteToken'] as String?,
      expiresAt: json['expiresAt'] != null
          ? DateTime.tryParse(json['expiresAt'] as String)
          : null,
    );
  }
}
