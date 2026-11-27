/// An active Hatly service area as the server reports it (centre + radius in metres) — drawn on the map and used to tell the
/// customer at once when a point is outside (the server checks again).
class ServiceAreaCircle {
  const ServiceAreaCircle({required this.id, required this.name, this.nameAr, required this.centerLatitude, required this.centerLongitude, required this.radiusMeters});

  final String id;
  final String name;
  final String? nameAr;
  final double centerLatitude;
  final double centerLongitude;
  final double radiusMeters;

  factory ServiceAreaCircle.fromJson(Map<String, dynamic> j) => ServiceAreaCircle(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        nameAr: j['nameAr'] as String?,
        centerLatitude: (j['centerLatitude'] as num).toDouble(),
        centerLongitude: (j['centerLongitude'] as num).toDouble(),
        radiusMeters: (j['radiusMeters'] as num).toDouble(),
      );
}
