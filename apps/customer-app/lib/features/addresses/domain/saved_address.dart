import 'delivery_zone.dart';

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
  });

  final String id;
  final String? label;
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

  bool get hasPin => latitude != null && longitude != null;

  /// True when the customer must (re)select a zone before this address can be delivered to.
  bool get needsZoneSelection => zoneStatus != AddressZoneStatus.ok;

  factory SavedAddress.fromJson(Map<String, dynamic> json) {
    final lat = (json['latitude'] as num?)?.toDouble();
    final lng = (json['longitude'] as num?)?.toDouble();
    final zone = json['deliveryZone'];
    return SavedAddress(
      id: json['id'] as String,
      label: json['label'] as String?,
      line1: json['line1'] as String,
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
      zoneStatus: json.containsKey('zoneStatus')
          ? AddressZoneStatus.fromWire(json['zoneStatus'] as String?)
          : (json['deliveryZoneId'] == null ? AddressZoneStatus.missing : AddressZoneStatus.ok),
    );
  }
}

/// What the customer submits when creating or editing an address. Only non-blank values are sent. Governorate and city are
/// derived by the server from the selected zone, so they are not sent.
class AddressInput {
  const AddressInput({
    this.label,
    required this.line1,
    required this.deliveryZoneId,
    this.latitude,
    this.longitude,
    this.removeLocation = false,
    this.instructions,
    this.street,
    this.buildingNumber,
    this.floor,
    this.apartment,
    this.landmark,
    this.formattedAddress,
    this.isDefault,
  });

  final String? label;
  final String line1;
  final String deliveryZoneId;

  /// Optional map pin — both or neither.
  final double? latitude;
  final double? longitude;

  /// Edit only: the customer removed a previously-saved pin (sent as `null` for both coordinates).
  final bool removeLocation;
  final String? instructions;
  final String? street;
  final String? buildingNumber;
  final String? floor;
  final String? apartment;
  final String? landmark;
  final String? formattedAddress;
  final bool? isDefault;

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{'line1': line1, 'deliveryZoneId': deliveryZoneId};
    if (latitude != null && longitude != null) {
      json['latitude'] = latitude;
      json['longitude'] = longitude;
    } else if (removeLocation) {
      json['latitude'] = null;
      json['longitude'] = null;
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
    put('formattedAddress', formattedAddress);
    if (isDefault != null) json['isDefault'] = isDefault;
    return json;
  }
}
