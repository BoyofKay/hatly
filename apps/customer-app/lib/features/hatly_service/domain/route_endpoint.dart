/// One end of a Hatly / Wasally route (PD-012): a point and the label the customer sees for it.
///
/// [source] says where the end came from: `CUSTOMER` (chosen in the app) or `DEFAULT` (the service's default, configured by Hatly
/// in the Admin Dashboard). The server resolves and prices the route; this model only carries what the customer chose and what the
/// server answered with.
class RouteEndpoint {
  const RouteEndpoint({
    required this.latitude,
    required this.longitude,
    required this.label,
    this.source = RouteEndpointSource.customer,
  });

  final double latitude;
  final double longitude;
  final String label;
  final String source;

  bool get isDefault => source == RouteEndpointSource.defaultLocation;

  /// Null for anything that is not a usable point — the app never invents a coordinate.
  static RouteEndpoint? tryParse(Object? json) {
    if (json is! Map) return null;
    final lat = json['latitude'];
    final lng = json['longitude'];
    if (lat is! num || lng is! num) return null;
    final label = json['label'];
    return RouteEndpoint(
      latitude: lat.toDouble(),
      longitude: lng.toDouble(),
      label: label is String ? label.trim() : '',
      source: json['source'] == RouteEndpointSource.defaultLocation
          ? RouteEndpointSource.defaultLocation
          : RouteEndpointSource.customer,
    );
  }

  Map<String, dynamic> toJson() =>
      {'latitude': latitude, 'longitude': longitude, 'label': label};

  @override
  bool operator ==(Object other) =>
      other is RouteEndpoint &&
      other.latitude == latitude &&
      other.longitude == longitude &&
      other.label == label &&
      other.source == source;

  @override
  int get hashCode => Object.hash(latitude, longitude, label, source);
}

class RouteEndpointSource {
  RouteEndpointSource._();
  static const String customer = 'CUSTOMER';
  static const String defaultLocation = 'DEFAULT';
}

/// The resolved route of a quote or order: origin → destination, direction preserved.
class ResolvedRoute {
  const ResolvedRoute({required this.origin, required this.destination});

  final RouteEndpoint origin;
  final RouteEndpoint destination;

  static ResolvedRoute? tryParse(Object? json) {
    if (json is! Map) return null;
    final origin = RouteEndpoint.tryParse(json['origin']);
    final destination = RouteEndpoint.tryParse(json['destination']);
    if (origin == null || destination == null) return null;
    return ResolvedRoute(origin: origin, destination: destination);
  }
}

/// The configured defaults (`GET /hatly-service/route-defaults`). A missing default is null — never a guess. Wasally has no origin
/// default: the customer always chooses where the pick-up happens.
class RouteDefaults {
  const RouteDefaults({
    this.hatlyOrigin,
    this.hatlyDestination,
    this.wasallyDestination,
  });

  /// What a backend without the endpoint (or an unreachable one) means: nothing is configured.
  static const RouteDefaults none = RouteDefaults();

  final RouteEndpoint? hatlyOrigin;
  final RouteEndpoint? hatlyDestination;
  final RouteEndpoint? wasallyDestination;

  factory RouteDefaults.fromJson(Map<String, dynamic> json) {
    RouteEndpoint? asDefault(Object? raw) {
      final e = RouteEndpoint.tryParse(raw);
      return e == null
          ? null
          : RouteEndpoint(
              latitude: e.latitude,
              longitude: e.longitude,
              label: e.label,
              source: RouteEndpointSource.defaultLocation);
    }

    final hatly = json['hatly'];
    final wasally = json['wasally'];
    return RouteDefaults(
      hatlyOrigin: asDefault(hatly is Map ? hatly['origin'] : null),
      hatlyDestination: asDefault(hatly is Map ? hatly['destination'] : null),
      wasallyDestination:
          asDefault(wasally is Map ? wasally['destination'] : null),
    );
  }
}
