/// Mirrors the real backend `DriverDeliveryView` field-for-field (see
/// `apps/backend/src/modules/delivery/driver-deliveries.service.ts`).
library;

class DeliveryOptionSnapshot {
  const DeliveryOptionSnapshot({required this.name, required this.valueName, required this.priceDeltaMinor});

  final String name;
  final String valueName;
  final int priceDeltaMinor;

  factory DeliveryOptionSnapshot.fromJson(Map<String, dynamic> json) {
    return DeliveryOptionSnapshot(
      name: json['name'] as String,
      valueName: json['valueName'] as String,
      priceDeltaMinor: json['priceDeltaMinor'] as int,
    );
  }
}

class DeliverySegmentItem {
  const DeliverySegmentItem({
    required this.id,
    this.productId,
    this.productNameSnapshot,
    required this.quantity,
    required this.optionsSnapshot,
    this.notes,
    this.freeTextDescriptionSnapshot,
    required this.imageUrlsSnapshot,
    this.pricingUnitSnapshot,
    this.requestedWeightGrams,
    this.actualWeightGrams,
  });

  final String id;
  final String? productId;
  final String? productNameSnapshot;
  final int quantity;
  final List<DeliveryOptionSnapshot> optionsSnapshot;
  final String? notes;
  final String? freeTextDescriptionSnapshot;
  final List<String> imageUrlsSnapshot;

  /// `'PIECE'` / `'WEIGHT'` / null (AD_HOC_SERVICE item).
  final String? pricingUnitSnapshot;
  final int? requestedWeightGrams;
  final int? actualWeightGrams;

  bool get isWeighted => pricingUnitSnapshot == 'WEIGHT';
  bool get isAdHoc => productId == null;

  factory DeliverySegmentItem.fromJson(Map<String, dynamic> json) {
    return DeliverySegmentItem(
      id: json['id'] as String,
      productId: json['productId'] as String?,
      productNameSnapshot: json['productNameSnapshot'] as String?,
      quantity: json['quantity'] as int,
      optionsSnapshot: (json['optionsSnapshot'] as List)
          .map((e) => DeliveryOptionSnapshot.fromJson(e as Map<String, dynamic>))
          .toList(),
      notes: json['notes'] as String?,
      freeTextDescriptionSnapshot: json['freeTextDescriptionSnapshot'] as String?,
      imageUrlsSnapshot: (json['imageUrlsSnapshot'] as List? ?? []).map((e) => e as String).toList(),
      pricingUnitSnapshot: json['pricingUnitSnapshot'] as String?,
      requestedWeightGrams: json['requestedWeightGrams'] as int?,
      actualWeightGrams: json['actualWeightGrams'] as int?,
    );
  }
}

class DeliverySegment {
  const DeliverySegment({
    required this.id,
    required this.groupType,
    required this.status,
    this.vendorBranchId,
    this.vendorBranchName,
    this.vendorBranchAddress,
    this.vendorBranchLatitude,
    this.vendorBranchLongitude,
    this.adHocPlaceNameSnapshot,
    this.adHocServiceTypeSnapshot,
    this.adHocPickupLatitudeSnapshot,
    this.adHocPickupLongitudeSnapshot,
    this.adHocDestinationLatitudeSnapshot,
    this.adHocDestinationLongitudeSnapshot,
    this.vendorNoteSnapshot,
    required this.items,
  });

  final String id;
  final String groupType;
  final String status;
  final String? vendorBranchId;
  final String? vendorBranchName;
  final String? vendorBranchAddress;
  final double? vendorBranchLatitude;
  final double? vendorBranchLongitude;
  final String? adHocPlaceNameSnapshot;
  final String? adHocServiceTypeSnapshot;
  final double? adHocPickupLatitudeSnapshot;
  final double? adHocPickupLongitudeSnapshot;
  final double? adHocDestinationLatitudeSnapshot;
  final double? adHocDestinationLongitudeSnapshot;
  final String? vendorNoteSnapshot;
  final List<DeliverySegmentItem> items;

  factory DeliverySegment.fromJson(Map<String, dynamic> json) {
    return DeliverySegment(
      id: json['id'] as String,
      groupType: json['groupType'] as String,
      status: json['status'] as String,
      vendorBranchId: json['vendorBranchId'] as String?,
      vendorBranchName: json['vendorBranchName'] as String?,
      vendorBranchAddress: json['vendorBranchAddress'] as String?,
      vendorBranchLatitude: (json['vendorBranchLatitude'] as num?)?.toDouble(),
      vendorBranchLongitude: (json['vendorBranchLongitude'] as num?)?.toDouble(),
      adHocPlaceNameSnapshot: json['adHocPlaceNameSnapshot'] as String?,
      adHocServiceTypeSnapshot: json['adHocServiceTypeSnapshot'] as String?,
      adHocPickupLatitudeSnapshot: (json['adHocPickupLatitudeSnapshot'] as num?)?.toDouble(),
      adHocPickupLongitudeSnapshot: (json['adHocPickupLongitudeSnapshot'] as num?)?.toDouble(),
      adHocDestinationLatitudeSnapshot: (json['adHocDestinationLatitudeSnapshot'] as num?)?.toDouble(),
      adHocDestinationLongitudeSnapshot: (json['adHocDestinationLongitudeSnapshot'] as num?)?.toDouble(),
      vendorNoteSnapshot: json['vendorNoteSnapshot'] as String?,
      items: (json['items'] as List).map((e) => DeliverySegmentItem.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }
}

/// The order's frozen delivery address. PD-009: the map pin is OPTIONAL — an address without one is located by its Delivery
/// Zone (e.g. "بلبيس — أبو نصيب", frozen with the order) plus the customer's written details. Coordinates are never invented.
class DeliveryAddress {
  const DeliveryAddress({
    this.label,
    required this.line1,
    this.latitude,
    this.longitude,
    this.instructions,
    this.zoneNameAr,
    this.zoneCityAr,
    this.buildingNumber,
    this.floor,
    this.apartment,
    this.landmark,
  });

  final String? label;
  final String line1;
  final double? latitude;
  final double? longitude;
  final String? instructions;
  final String? zoneNameAr;
  final String? zoneCityAr;
  final String? buildingNumber;
  final String? floor;
  final String? apartment;
  final String? landmark;

  bool get hasPin => latitude != null && longitude != null;

  /// "بلبيس — أبو نصيب", or null for an order placed before zones existed.
  String? get areaLabel {
    if (zoneNameAr == null) return null;
    return zoneCityAr == null ? zoneNameAr : '$zoneCityAr — $zoneNameAr';
  }

  factory DeliveryAddress.fromJson(Map<String, dynamic> json) {
    final zone = json['deliveryZone'];
    double? number(Object? v) => v is num ? v.toDouble() : null;
    final lat = number(json['latitude']);
    final lng = number(json['longitude']);
    return DeliveryAddress(
      label: json['label'] as String?,
      // A GPS address has no written line (the server stores ''): show its coordinates instead of a blank.
      line1: ((json['line1'] as String?)?.trim().isNotEmpty ?? false)
          ? json['line1'] as String
          : (json['latitude'] is num && json['longitude'] is num
              ? 'GPS ${(json['latitude'] as num).toStringAsFixed(5)}, ${(json['longitude'] as num).toStringAsFixed(5)}'
              : ''),
      // A half pin is treated as no pin.
      latitude: lat != null && lng != null ? lat : null,
      longitude: lat != null && lng != null ? lng : null,
      instructions: json['instructions'] as String?,
      zoneNameAr: zone is Map ? zone['nameAr'] as String? : null,
      zoneCityAr: zone is Map ? zone['cityAr'] as String? : null,
      buildingNumber: json['buildingNumber'] as String?,
      floor: json['floor'] as String?,
      apartment: json['apartment'] as String?,
      landmark: json['landmark'] as String?,
    );
  }
}

/// Driver Core + Dispatch Foundation milestone. Mirrors the backend's
/// `DriverFailedDeliveryReason` exactly (`driver-failed-delivery-reason.enum.ts`) — a controlled
/// vocabulary for WHY a delivery could not be completed, so the app never sends free text the
/// backend would now reject. `label` is the ONLY new user-facing string this milestone adds; kept
/// as a plain English map (matching this screen's own existing convention — no l10n is wired into
/// this screen's other strings yet) rather than introducing localization for one isolated widget.
enum DriverFailedDeliveryReason {
  customerUnreachable('CUSTOMER_UNREACHABLE', 'Customer unreachable', 'لا يمكن الوصول للعميل'),
  customerRefused('CUSTOMER_REFUSED', 'Customer refused delivery', 'العميل رفض الاستلام'),
  addressNotFound('ADDRESS_NOT_FOUND', 'Address not found', 'لم أجد العنوان'),
  unsafeLocation('UNSAFE_LOCATION', 'Unsafe location', 'مكان غير آمن'),
  vehicleIssue('VEHICLE_ISSUE', 'Vehicle issue', 'عطل في المركبة'),
  other('OTHER', 'Other', 'سبب آخر');

  const DriverFailedDeliveryReason(this.wireValue, this.label, this.labelAr);

  /// The exact string the backend's enum expects.
  final String wireValue;

  /// English label (the default in tests and for English users).
  final String label;
  final String labelAr;

  /// The label in the language of the screen it is shown on.
  String localized(bool arabic) => arabic ? labelAr : label;
}

/// One end of a Hatly / Wasally route as the customer's order froze it (PD-012): a point, the label the customer saw, and whether the
/// customer chose it or it was the service's default. The driver goes to the ORIGIN first, then the DESTINATION.
class RoutePoint {
  const RoutePoint({required this.latitude, required this.longitude, required this.label, required this.isDefault});

  final double latitude;
  final double longitude;
  final String label;
  final bool isDefault;

  static RoutePoint? tryParse(Object? json) {
    if (json is! Map) return null;
    final lat = json['latitude'];
    final lng = json['longitude'];
    if (lat is! num || lng is! num) return null;
    final label = json['label'];
    return RoutePoint(
      latitude: lat.toDouble(),
      longitude: lng.toDouble(),
      label: label is String && label.trim().isNotEmpty ? label.trim() : 'GPS ${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}',
      isDefault: json['source'] == 'DEFAULT',
    );
  }
}

class ServiceRoute {
  const ServiceRoute({required this.service, required this.origin, required this.destination});

  /// `HATLY` / `WASALLY` / null.
  final String? service;
  final RoutePoint origin;
  final RoutePoint destination;

  static ServiceRoute? tryParse(Object? json) {
    if (json is! Map) return null;
    final origin = RoutePoint.tryParse(json['origin']);
    final destination = RoutePoint.tryParse(json['destination']);
    if (origin == null || destination == null) return null;
    return ServiceRoute(service: json['service'] as String?, origin: origin, destination: destination);
  }
}

class Delivery {
  const Delivery({
    required this.id,
    required this.orderId,
    this.orderNumber,
    required this.orderStatus,
    required this.fulfillmentType,
    this.orderNote,
    required this.paymentMethod,
    this.electronicPaymentMethod,
    required this.totalMinor,
    this.amountDueMinor,
    required this.customerName,
    this.customerPhone,
    required this.deliveryAddress,
    this.assignedAt,
    this.acceptDeadlineAt,
    this.acknowledgedAt,
    this.pickedUpAt,
    this.deliveredAt,
    required this.segments,
    this.serviceRoute,
  });

  final String id;
  final String orderId;

  /// The human order number (HT-…). Null only for an older backend that does not send it; the UI then falls back to a short id.
  final String? orderNumber;

  /// The Order-level status — CONFIRMED (locked decision): the Driver
  /// UI only ever writes to this via the approved lifecycle actions
  /// (Pickup/On The Way/Delivered/Failed); there is no separate
  /// Accept/Reject action or state anywhere in this app.
  final String orderStatus;

  /// Order states in which the order still needs the driver. Everything else (delivered, cancelled, failed, collected, or released back to
  /// "waiting for a driver") is not active — whatever any vendor part's own status says (a multi-store order is one order for the driver).
  static const activeStatuses = {'ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY', 'PENDING', 'CONFIRMED', 'PREPARING'};

  /// Early dispatch (2026-11-22): the driver is attached while the store still prepares the order (Confirmed / Preparing). They head to
  /// the store; "Picked up" is offered only once the store marks the order ready.
  bool get isBeingPrepared => orderStatus == 'PENDING' || orderStatus == 'CONFIRMED' || orderStatus == 'PREPARING';
  bool get isActive => activeStatuses.contains(orderStatus);
  final String fulfillmentType;
  final String? orderNote;
  final String paymentMethod;
  final String? electronicPaymentMethod;

  /// Null while the order's final price is not known yet — a Hatly Service order whose item price is still to be confirmed.
  /// Never shown as 0.
  final int? totalMinor;

  /// Driver Core + Dispatch Foundation milestone. What must actually be collected on delivery —
  /// NEVER `totalMinor` (which can overstate it once a wallet credit already covered part of the
  /// order). Null for orders where nothing is collected on delivery (e.g. an already-paid Manual
  /// Transfer, or a legacy order predating this field).
  final int? amountDueMinor;
  final String customerName;

  /// Null when the server withholds it (data minimisation: a completed delivery no longer needs the customer's number). The
  /// screen then shows no number and no call button — it must never crash on a missing phone.
  final String? customerPhone;
  final DeliveryAddress deliveryAddress;
  final DateTime? assignedAt;
  /// R16: acknowledge the assignment by this time (Operations are alerted after it — nothing is taken away automatically).
  final DateTime? acceptDeadlineAt;

  /// R16: when this driver confirmed having seen the assignment; null = not yet.
  final DateTime? acknowledgedAt;
  final DateTime? pickedUpAt;
  final DateTime? deliveredAt;
  final List<DeliverySegment> segments;

  /// R16: an assigned order the driver has not confirmed yet — the only action offered is the acknowledgement.
  bool get needsAcknowledgement => (orderStatus == 'ASSIGNED_TO_DRIVER' || isBeingPrepared) && acknowledgedAt == null;

  /// Hatly / Wasally orders only: where to go first and where to deliver (the customer's address is then only who to contact). Null for
  /// every other order and for one placed before PD-012.
  final ServiceRoute? serviceRoute;

  /// Whether this delivery has cash/electronic money still owed to be collected at the door.
  /// What the driver and customer call this order: its number, or (older backend) a short id.
  String get displayNumber => orderNumber ?? (orderId.length > 8 ? orderId.substring(0, 8) : orderId);

  bool get hasCollectionOnDelivery => paymentMethod == 'COD' || paymentMethod == 'PAY_AT_DELIVERY';

  factory Delivery.fromJson(Map<String, dynamic> json) {
    return Delivery(
      id: json['id'] as String,
      orderId: json['orderId'] as String,
      orderNumber: json['orderNumber'] as String?,
      orderStatus: json['orderStatus'] as String,
      fulfillmentType: json['fulfillmentType'] as String,
      orderNote: json['orderNote'] as String?,
      paymentMethod: json['paymentMethod'] as String,
      electronicPaymentMethod: json['electronicPaymentMethod'] as String?,
      totalMinor: (json['totalMinor'] as num?)?.toInt(),
      amountDueMinor: json['amountDueMinor'] as int?,
      customerName: json['customerName'] as String,
      customerPhone: (json['customerPhone'] as String?)?.trim().isEmpty ?? true ? null : (json['customerPhone'] as String).trim(),
      deliveryAddress: DeliveryAddress.fromJson(json['deliveryAddress'] as Map<String, dynamic>),
      assignedAt: json['assignedAt'] != null ? DateTime.parse(json['assignedAt'] as String) : null,
      acceptDeadlineAt: json['acceptDeadlineAt'] != null ? DateTime.parse(json['acceptDeadlineAt'] as String) : null,
      acknowledgedAt: json['acknowledgedAt'] != null ? DateTime.parse(json['acknowledgedAt'] as String) : null,
      pickedUpAt: json['pickedUpAt'] != null ? DateTime.parse(json['pickedUpAt'] as String) : null,
      deliveredAt: json['deliveredAt'] != null ? DateTime.parse(json['deliveredAt'] as String) : null,
      segments: (json['segments'] as List).map((e) => DeliverySegment.fromJson(e as Map<String, dynamic>)).toList(),
      serviceRoute: ServiceRoute.tryParse(json['serviceRoute']),
    );
  }
}
