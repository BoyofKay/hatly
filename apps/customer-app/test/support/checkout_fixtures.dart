import 'package:hatly_customer/features/cart/domain/cart.dart';

/// A realistic `POST /checkout/quote` `data` object (single vendor, delivery, serviceable default address). Override any
/// top-level section with [overrides]; pass `null` values to drop a section.
Map<String, dynamic> quoteJson({
  Map<String, dynamic> overrides = const {},
  int subtotal = 10000,
  int discount = 0,
  int? fee = 1500,
  int wallet = 0,
  bool canPlace = true,
}) {
  final total = fee == null ? null : subtotal + fee - discount;
  final base = <String, dynamic>{
    'canPlaceOrder': canPlace,
    'blockers': <Map<String, dynamic>>[],
    'fulfillment': {
      'type': 'DELIVERY',
      'pickupAvailable': true,
      'pickupUnavailableReason': null,
      'pickupBranch': null,
    },
    'address': {
      'addressId': 'addr-1',
      'source': 'DEFAULT',
      'snapshot': {
        'label': 'المنزل',
        'line1': 'شارع الجمهورية، بلبيس',
        'latitude': 30.4,
        'longitude': 31.56,
        'governorate': 'الشرقية',
        'city': 'بلبيس',
        'buildingNumber': '12',
        'floor': '3',
        'apartment': '8',
        'landmark': 'بجوار الصيدلية',
        'instructions': 'الجرس معطل، اتصل بي',
      },
    },
    'eligibility': {
      'serviceable': true,
      'serviceAreaId': 'area-1',
      'vendors': <dynamic>[],
    },
    'summary': {
      'subtotalMinor': subtotal,
      'discountMinor': discount,
      'deliveryFeeMinor': fee,
      'totalMinor': total,
      'walletAppliedMinor': wallet,
      'amountDueMinor': total == null ? null : total - wallet,
    },
    'delivery': {
      'applicable': true,
      'source': 'FRESH',
      'feeMinor': fee,
      'baseFeeMinor': fee,
      'additionalVendorFeeMinor': 0,
      'additionalVendorChargeMinor': 0,
      'vendorCount': 1,
      'distanceMeters': 3400,
      'vendors': [
        {
          'vendorBranchId': 'b1',
          'name': 'مطعم النخيل',
          'distanceToCustomerMeters': 3400
        },
      ],
      'eta': {
        'available': true,
        'preparationMinutes': 20,
        'travelMinutes': 15,
        'estimatedMinutes': 35,
        'rangeMinMinutes': 35,
        'rangeMaxMinutes': 45,
      },
    },
    'vendors': [
      {
        'vendorBranchId': 'b1',
        'name': 'مطعم النخيل',
        'subtotalMinor': subtotal,
        'discountMinor': discount,
        'itemCount': 2,
        'preparationMinutes': 20,
        'couponApplied': false,
      },
    ],
    'coupon': {'status': 'NONE'},
    'payment': {
      'selected': {'method': 'COD', 'electronicMethod': null},
      'awaitsPaymentApproval': false,
      'wallet': {'balanceMinor': 5000, 'appliedMinor': wallet, 'available': true},
      'options': {
        'cod': true,
        'payAtDelivery': true,
        'manualTransfer': {'available': true, 'reason': null},
        'electronicMethods': [
          'INSTAPAY',
          'VODAFONE_CASH',
          'ORANGE_CASH',
          'ETISALAT_CASH',
          'WE_PAY',
        ],
      },
    },
    'quoteToken': 'token-1',
    'expiresAt': '2099-01-01T00:00:00.000Z',
  };
  for (final e in overrides.entries) {
    base[e.key] = e.value;
  }
  return base;
}

CartItem cartItem({
  String id = 'i1',
  String name = 'برجر لحم',
  int quantity = 2,
  int unitPrice = 5000,
}) =>
    CartItem(
      id: id,
      productId: 'p-$id',
      productName: name,
      quantity: quantity,
      unitPriceMinor: unitPrice,
      lineTotalMinor: unitPrice * quantity,
      isAvailable: true,
      selectedOptionValues: const [],
      imageUrls: const [],
    );

Cart cart({List<CartItem>? items}) {
  final list = items ?? [cartItem()];
  final subtotal = list.fold<int>(0, (s, i) => s + (i.lineTotalMinor ?? 0));
  return Cart(
    id: 'cart-1',
    fulfillmentType: 'DELIVERY',
    groups: [
      CartGroup(
        id: 'g1',
        groupType: 'CATALOG',
        vendorBranchId: 'b1',
        vendorName: 'مطعم النخيل',
        items: list,
        subtotalMinor: subtotal,
        hasSubtotalDiscountOffer: false,
      ),
    ],
    subtotalMinor: subtotal,
    hasUnpricedItems: false,
    readyForCheckout: true,
  );
}
