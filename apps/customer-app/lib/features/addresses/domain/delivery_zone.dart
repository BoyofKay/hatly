/// A Delivery Zone (PD-009) — a named local delivery area such as "بلبيس — أبو نصيب", always from the backend
/// (`GET /delivery-zones`), never hardcoded in the app. For an address WITHOUT a map pin the zone the customer selects decides
/// whether Hatly delivers there and its base delivery fee; the checkout quote stays the authoritative price.
class DeliveryZone {
  const DeliveryZone({
    required this.id,
    required this.name,
    required this.nameAr,
    required this.city,
    required this.cityAr,
    required this.governorate,
    required this.governorateAr,
    this.deliveryFeeMinor,
  });

  final String id;
  final String name;
  final String nameAr;
  final String city;
  final String cityAr;
  final String governorate;
  final String governorateAr;

  /// The zone's current base fee (informational — only present on the zone list, never on a frozen snapshot).
  final int? deliveryFeeMinor;

  /// The zone name in the app's language.
  String displayName(bool arabic) => arabic ? nameAr : name;
  String displayCity(bool arabic) => arabic ? cityAr : city;
  String displayGovernorate(bool arabic) => arabic ? governorateAr : governorate;

  /// "بلبيس — أبو نصيب" / "Belbeis — Abu Naseeb".
  String areaLabel(bool arabic) => '${displayCity(arabic)} — ${displayName(arabic)}';

  factory DeliveryZone.fromJson(Map<String, dynamic> json) => DeliveryZone(
        id: json['id'] as String,
        name: json['name'] as String? ?? json['nameAr'] as String,
        nameAr: json['nameAr'] as String,
        city: json['city'] as String? ?? json['cityAr'] as String? ?? '',
        cityAr: json['cityAr'] as String? ?? json['city'] as String? ?? '',
        governorate: json['governorate'] as String? ?? json['governorateAr'] as String? ?? '',
        governorateAr: json['governorateAr'] as String? ?? json['governorate'] as String? ?? '',
        deliveryFeeMinor: (json['deliveryFeeMinor'] as num?)?.toInt(),
      );

  @override
  bool operator ==(Object other) => other is DeliveryZone && other.id == id;

  @override
  int get hashCode => id.hashCode;
}
