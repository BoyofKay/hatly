import 'delivery_zone.dart';

/// How a delivery address is identified — two ALTERNATIVE methods, never two steps of one flow. MANUAL: the customer chooses a
/// delivery area and writes the address (no coordinates; the area's fixed fee is the base fee). GPS: the coordinates are the
/// address (no area, no text; the base fee is the road distance). An address saved before the methods existed has no mode.
enum AddressMode {
  gps,
  manual;

  static AddressMode? fromWire(String? value) {
    switch (value) {
      case 'GPS':
        return AddressMode.gps;
      case 'MANUAL':
        return AddressMode.manual;
      default:
        return null;
    }
  }

  String get wire => this == AddressMode.gps ? 'GPS' : 'MANUAL';
}

/// What the app may offer right now (`GET /addresses/capabilities`). [supportsModes] is false against a backend that predates the two
/// methods: the app then keeps the single legacy form (area + text, no mode sent) and offers no GPS.
class AddressCapabilities {
  const AddressCapabilities({
    required this.manualAvailable,
    required this.gpsAvailable,
    this.gpsUnavailableReason,
    this.supportsModes = true,
  });

  final bool manualAvailable;
  final bool gpsAvailable;

  /// `MAPS_DISABLED`, `PRICING_NOT_CONFIGURED` or `NO_SERVICE_AREA` when GPS cannot be offered.
  final String? gpsUnavailableReason;
  final bool supportsModes;

  static const legacyBackend = AddressCapabilities(manualAvailable: true, gpsAvailable: false, supportsModes: false);

  factory AddressCapabilities.fromJson(Map<String, dynamic> json) {
    final manual = json['manual'];
    final gps = json['gps'];
    return AddressCapabilities(
      manualAvailable: manual is Map && manual['available'] == true,
      gpsAvailable: gps is Map && gps['available'] == true,
      gpsUnavailableReason: gps is Map ? gps['reason'] as String? : null,
    );
  }
}

/// The text shown for a GPS address, which has no typed line: its coordinates (language-neutral; the list also says "GPS location").
String gpsAddressText(double latitude, double longitude) => '${latitude.toStringAsFixed(5)}, ${longitude.toStringAsFixed(5)}';

/// Where a saved address stands with respect to Delivery Zones (PD-009), as reported by the server.
enum AddressZoneStatus {
  /// The address has an active zone.
  ok,

  /// Saved before zones existed — the customer must choose one (it is never guessed).
  missing,

  /// Its zone is no longer available — the customer must choose another.
  unavailable;

  static AddressZoneStatus fromWire(String? value) {
    switch (value) {
      case 'MISSING':
        return AddressZoneStatus.missing;
      case 'UNAVAILABLE':
        return AddressZoneStatus.unavailable;
      default:
        return AddressZoneStatus.ok;
    }
  }
}

/// A saved customer address. PD-009: the selected Delivery Zone locates it; the map pin (latitude/longitude) is OPTIONAL and,
/// when present, stays the authoritative location. [formattedAddress] is only an assistive suggestion from the map provider;
/// the structured fields below are what the customer typed for the driver.
class SavedAddress {
  const SavedAddress({
    required this.id,
    this.mode,
    this.label,
    required this.line1,
    this.latitude,
    this.longitude,
    this.instructions,
    this.governorate,
    this.city,
    this.street,
    this.buildingNumber,
    this.floor,
    this.apartment,
    this.landmark,
    this.formattedAddress,
    this.isDefault = false,
    this.deliveryZoneId,
    this.deliveryZone,
    this.zoneStatus = AddressZoneStatus.ok,
    this.zoneUnavailableReason,
  });

  final String id;

  /// How the address is identified; null for an address saved before the two methods existed.
  final AddressMode? mode;
  final String? label;

  /// The written address. For a GPS address (which has none) the coordinates as text, so every list has something to show.
  final String line1;
  final double? latitude;
  final double? longitude;
  final String? instructions;
  final String? governorate;
  final String? city;
  final String? street;
  final String? buildingNumber;
  final String? floor;
  final String? apartment;
  final String? landmark;
  final String? formattedAddress;
  final bool isDefault;
  final String? deliveryZoneId;
  final DeliveryZone? deliveryZone;
  final AddressZoneStatus zoneStatus;
  /// Server-derived reason a saved manual address cannot be selected for new orders.
  final String? zoneUnavailableReason;

  bool get hasPin => latitude != null && longitude != null;

  /// True when the customer must (re)select a zone before this address can be delivered to.
  bool get needsZoneSelection => zoneStatus != AddressZoneStatus.ok;

  factory SavedAddress.fromJson(Map<String, dynamic> json) {
    final lat = (json['latitude'] as num?)?.toDouble();
    final lng = (json['longitude'] as num?)?.toDouble();
    final zone = json['deliveryZone'];
    return SavedAddress(
      id: json['id'] as String,
      mode: AddressMode.fromWire(json['mode'] as String?),
      label: json['label'] as String?,
      line1: ((json['line1'] as String?)?.trim().isNotEmpty ?? false)
          ? json['line1'] as String
          : (lat != null && lng != null
              // A GPS address has no typed text: show the map provider's resolved address when there is one, else the coordinates.
              ? (((json['formattedAddress'] as String?)?.trim().isNotEmpty ?? false) ? (json['formattedAddress'] as String).trim() : gpsAddressText(lat, lng))
              : ''),
      latitude: lat != null && lng != null ? lat : null,
      longitude: lat != null && lng != null ? lng : null,
      instructions: json['instructions'] as String?,
      governorate: json['governorate'] as String?,
      city: json['city'] as String?,
      street: json['street'] as String?,
      buildingNumber: json['buildingNumber'] as String?,
      floor: json['floor'] as String?,
      apartment: json['apartment'] as String?,
      landmark: json['landmark'] as String?,
      formattedAddress: json['formattedAddress'] as String?,
      isDefault: json['isDefault'] as bool? ?? false,
      deliveryZoneId: json['deliveryZoneId'] as String?,
      deliveryZone: zone is Map<String, dynamic> ? DeliveryZone.fromJson(zone) : null,
      // An older server without zones reports nothing: a zone-less address is then MISSING, never assumed OK.
      zoneUnavailableReason: json['zoneUnavailableReason'] as String?,
      zoneStatus: json.containsKey('zoneStatus')
          ? AddressZoneStatus.fromWire(json['zoneStatus'] as String?)
          : (json['deliveryZoneId'] == null ? AddressZoneStatus.missing : AddressZoneStatus.ok),
    );
  }
}

/// What the customer submits when creating or editing an address — ONE of the two methods, never a mix:
///  - [AddressInput.manual]: the delivery area + the written address (no coordinates are ever sent);
///  - [AddressInput.gps]: the coordinates (no area, no written address).
/// Only non-blank optional values are sent. Governorate and city are derived by the server from the selected zone. [includeMode] is
/// false only against a backend that predates the two methods (see [AddressCapabilities.supportsModes]).
class AddressInput {
  const AddressInput.manual({
    this.label,
    required String this.line1,
    required String this.deliveryZoneId,
    this.instructions,
    this.street,
    this.buildingNumber,
    this.floor,
    this.apartment,
    this.landmark,
    this.isDefault,
    this.includeMode = true,
  })  : mode = AddressMode.manual,
        latitude = null,
        longitude = null,
        formattedAddress = null;

  const AddressInput.gps({
    this.label,
    required double this.latitude,
    required double this.longitude,
    this.instructions,
    this.isDefault,
    this.formattedAddress,
  })  : mode = AddressMode.gps,
        line1 = null,
        deliveryZoneId = null,
        street = null,
        buildingNumber = null,
        floor = null,
        apartment = null,
        landmark = null,
        includeMode = true;

  final AddressMode mode;
  final String? label;
  final String? line1;
  final String? deliveryZoneId;
  final double? latitude;
  final double? longitude;
  final String? instructions;
  final String? street;
  final String? buildingNumber;
  final String? floor;
  final String? apartment;
  final String? landmark;
  final bool? isDefault;
  final bool includeMode;

  /// GPS only: the address the map provider resolved for the pin. Assistive display text — never authoritative and never priced.
  final String? formattedAddress;

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (includeMode) json['mode'] = mode.wire;
    if (mode == AddressMode.manual) {
      json['line1'] = line1;
      json['deliveryZoneId'] = deliveryZoneId;
    } else {
      json['latitude'] = latitude;
      json['longitude'] = longitude;
    }
    void put(String key, String? value) {
      final trimmed = value?.trim();
      if (trimmed != null && trimmed.isNotEmpty) json[key] = trimmed;
    }

    put('label', label);
    put('instructions', instructions);
    put('street', street);
    put('buildingNumber', buildingNumber);
    put('floor', floor);
    put('apartment', apartment);
    put('landmark', landmark);
    if (mode == AddressMode.gps) put('formattedAddress', formattedAddress);
    if (isDefault != null) json['isDefault'] = isDefault;
    return json;
  }
}
