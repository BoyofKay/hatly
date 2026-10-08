/// JSON in the exact shape the backend returns (`CustomerOrderDetailsView` / summary / tracking).
const orderId = '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab';
const orderNumber = 'HT-100001';

Map<String, dynamic> orderDetailsJson({
  String status = 'PENDING',
  String paymentMethod = 'COD',
  String? electronicMethod,
  String? paymentStatus = 'DUE_ON_DELIVERY',
  bool awaiting = false,
  int wallet = 0,
  bool canCancel = true,
  bool pickup = false,
  Map<String, dynamic>? eta,
  Map<String, dynamic>? coupon,
  int discount = 0,
  bool withBreakdown = true,
}) {
  final total = 10000 + 1500 - discount;
  return {
    'id': orderId,
    'orderNumber': orderNumber,
    'createdAt': '2026-09-01T12:00:00.000Z',
    'status': status,
    'fulfillmentType': pickup ? 'PICKUP' : 'DELIVERY',
    'deliveryAddressSnapshot': pickup
        ? null
        : {
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
          },
    'subtotalMinor': 10000,
    'deliveryFeeMinor': pickup ? 0 : 1500,
    'discountMinor': discount,
    'totalMinor': total,
    'paymentMethod': paymentMethod,
    'electronicPaymentMethod': electronicMethod,
    'walletAmountMinor': wallet,
    'amountDueMinor': total - wallet,
    'coupon': coupon,
    'deliveryBreakdown': pickup || !withBreakdown
        ? null
        : {
            'baseFeeMinor': 1000,
            'additionalVendorFeeMinor': 500,
            'additionalVendorChargeMinor': 500,
            'vendorCount': 2,
            'distanceMeters': 3400,
            'frozenTotalFeeMinor': 1500,
            'vendors': [],
          },
    'eta': eta ??
        {
          'state': 'ESTIMATED',
          'estimatedAt': '2026-09-01T12:35:00.000Z',
          'estimatedUntil': '2026-09-01T12:45:00.000Z',
          'delayed': false,
        },
    'timeline': [
      {
        'status': 'PENDING',
        'at': '2026-09-01T12:00:00.000Z',
        'actorRole': 'CUSTOMER'
      },
      if (status != 'PENDING')
        {
          'status': status,
          'at': '2026-09-01T12:10:00.000Z',
          'actorRole': 'VENDOR'
        },
    ],
    'customerCanCancel': canCancel,
    'payment': {
      'method': paymentMethod,
      'status': paymentStatus,
      'amountMinor': total - wallet,
      'electronicMethod': electronicMethod,
      'walletAmountMinor': wallet,
      'amountDueMinor': total - wallet,
      'awaitingApproval': awaiting,
    },
    'cancellationReason': null,
    'cancelledByRole': null,
    'failureReason': null,
    'failedAt': null,
    'segments': [
      {
        'id': 's1',
        'groupType': 'CATALOG',
        'vendorBranchId': 'b1',
        'vendorBranchName': 'مطعم النخيل',
        'branchAddress': 'شارع البحر',
        'status': status,
        'subtotalMinor': 6000,
        'offerDiscountAmountMinor': null,
        'couponCodeSnapshot': coupon?['code'],
        'expectedReadyAt': '2026-09-01T12:25:00.000Z',
        'preparationEstimateMinutes': 25,
        'items': [
          {
            'id': 'i1',
            'productId': 'p1',
            'productNameSnapshot': 'برجر لحم',
            'quantity': 2,
            'unitPriceMinor': 3000,
            'optionsSnapshot': [
              {'name': 'الحجم', 'valueName': 'كبير', 'priceDeltaMinor': 500},
              {'name': 'الصوص', 'valueName': 'ثوم', 'priceDeltaMinor': 0},
            ],
            'notes': 'بدون بصل',
          },
        ],
      },
      {
        'id': 's2',
        'groupType': 'CATALOG',
        'vendorBranchId': 'b2',
        'vendorBranchName': 'صيدلية الأمل',
        'status': status,
        'subtotalMinor': 4000,
        'expectedReadyAt': null,
        'preparationEstimateMinutes': null,
        'items': [
          {
            'id': 'i2',
            'productId': 'p2',
            'productNameSnapshot': 'بنادول',
            'quantity': 1,
            'unitPriceMinor': 4000,
            'optionsSnapshot': [],
          },
        ],
      },
    ],
    'driver': null,
  };
}

Map<String, dynamic> orderSummaryJson({
  String id = orderId,
  String orderNumberValue = orderNumber,
  String status = 'PENDING',
  String paymentMethod = 'COD',
  String? electronicMethod,
  bool awaiting = false,
  List<String> vendors = const ['مطعم النخيل'],
  List<String> images = const [],
  Map<String, dynamic>? eta,
}) =>
    {
      'id': id,
      'orderNumber': orderNumberValue,
      'createdAt': '2026-09-01T12:00:00.000Z',
      'status': status,
      'totalMinor': 11500,
      'paymentMethod': paymentMethod,
      'electronicPaymentMethod': electronicMethod,
      'awaitingPaymentApproval': awaiting,
      'fulfillmentType': 'DELIVERY',
      'vendorBranchNames': vendors,
      'itemImageUrls': images,
      'itemCount': 3,
      'eta': eta ??
          {
            'state': 'ESTIMATED',
            'estimatedAt': '2026-09-01T12:35:00.000Z',
            'estimatedUntil': '2026-09-01T12:45:00.000Z',
            'delayed': false,
          },
    };

Map<String, dynamic> trackingJson({
  String status = 'PREPARING',
  bool awaiting = false,
  String paymentMethod = 'COD',
}) =>
    {
      'orderId': orderId,
      'orderNumber': orderNumber,
      'status': status,
      'fulfillmentType': 'DELIVERY',
      'eta': {
        'state': 'ESTIMATED',
        'estimatedAt': '2026-09-01T12:35:00.000Z',
        'estimatedUntil': '2026-09-01T12:45:00.000Z',
        'delayed': false,
      },
      'timeline': [
        {
          'status': 'PENDING',
          'at': '2026-09-01T12:00:00.000Z',
          'actorRole': 'CUSTOMER'
        },
        {
          'status': 'CONFIRMED',
          'at': '2026-09-01T12:05:00.000Z',
          'actorRole': 'VENDOR'
        },
        {
          'status': 'PREPARING',
          'at': '2026-09-01T12:10:00.000Z',
          'actorRole': 'VENDOR'
        },
      ],
      'segments': [
        {
          'id': 's1',
          'vendorName': 'مطعم النخيل',
          'status': 'PREPARING',
          'expectedReadyAt': '2026-09-01T12:25:00.000Z',
          'preparationEstimateMinutes': 25,
        },
        {
          'id': 's2',
          'vendorName': 'صيدلية الأمل',
          'status': 'READY_FOR_PICKUP',
          'expectedReadyAt': null,
          'preparationEstimateMinutes': null,
        },
      ],
      'payment': {
        'method': paymentMethod,
        'electronicMethod': null,
        'status': 'DUE_ON_DELIVERY',
        'awaitingApproval': awaiting,
      },
      'customerCanCancel': false,
      'cancellationReason': null,
    };
