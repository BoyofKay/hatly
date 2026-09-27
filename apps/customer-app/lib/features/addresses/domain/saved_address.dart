/// A saved customer address. The map pin (latitude/longitude) is the authoritative location; [formattedAddress] is only an
/// assistive suggestion from the map provider, and the structured fields below are what the customer typed for the driver.
class SavedAddress {
  const SavedAddress({
    required this.id,
    this.label,
    required this.line1,
    required this.latitude,
    required this.longitude,
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
  });

  final String id;
  final String? label;
  final String line1;
  final double latitude;
  final double longitude;
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

  factory SavedAddress.fromJson(Map<String, dynamic> json) {
    return SavedAddress(
      id: json['id'] as String,
      label: json['label'] as String?,
      line1: json['line1'] as String,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
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
    );
  }
}

/// What the customer submits when creating or editing an address. Only non-blank values are sent.
class AddressInput {
  const AddressInput({
    this.label,
    required this.line1,
    required this.latitude,
    required this.longitude,
    this.instructions,
    this.governorate,
    this.city,
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
  final double latitude;
  final double longitude;
  final String? instructions;
  final String? governorate;
  final String? city;
  final String? street;
  final String? buildingNumber;
  final String? floor;
  final String? apartment;
  final String? landmark;
  final String? formattedAddress;
  final bool? isDefault;

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{
      'line1': line1,
      'latitude': latitude,
      'longitude': longitude,
    };
    void put(String key, String? value) {
      final trimmed = value?.trim();
      if (trimmed != null && trimmed.isNotEmpty) json[key] = trimmed;
    }

    put('label', label);
    put('instructions', instructions);
    put('governorate', governorate);
    put('city', city);
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
