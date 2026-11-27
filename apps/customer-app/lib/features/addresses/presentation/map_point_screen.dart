import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_key_value_row.dart';
import '../data/addresses_providers.dart';
import '../domain/service_area.dart';

/// Two places closer than this are the same place (the server applies the same rule).
const double samePlaceMeters = 50;

double distanceMeters(double aLat, double aLng, double bLat, double bLng) {
  double r(double d) => d * math.pi / 180;
  final h = math.pow(math.sin(r(bLat - aLat) / 2), 2) +
      math.cos(r(aLat)) * math.cos(r(bLat)) * math.pow(math.sin(r(bLng - aLng) / 2), 2);
  return 6371000 * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h));
}

/// True when [areas] is empty (not known: the server decides) or the point is inside one of them.
bool insideServiceAreas(List<ServiceAreaCircle> areas, double lat, double lng) =>
    areas.isEmpty || areas.any((a) => distanceMeters(lat, lng, a.centerLatitude, a.centerLongitude) <= a.radiusMeters);

/// Opens the full-screen map and returns the chosen point, or null when the customer goes back.
Future<LatLng?> pickPointOnMap(BuildContext context, {double? latitude, double? longitude, LatLng? avoid}) {
  return Navigator.of(context).push<LatLng>(MaterialPageRoute(
    fullscreenDialog: true,
    builder: (_) => MapPointScreen(latitude: latitude, longitude: longitude, avoid: avoid, showTiles: MapPointScreen.tilesEnabled),
  ));
}

/// Owner UAT 2026-11-27 (ML-03): choose the place on a map. OpenStreetMap (works on Android and iPhone, no key): the map moves under
/// a fixed centre pin; the served areas are drawn; search and "my location" move the map. A point outside the served areas, or the
/// same place as the other end of the route ([avoid]), cannot be confirmed.
class MapPointScreen extends ConsumerStatefulWidget {
  const MapPointScreen({super.key, this.latitude, this.longitude, this.avoid, this.showTiles = true});

  /// Widget tests turn the network map tiles off.
  static bool tilesEnabled = true;

  final double? latitude;
  final double? longitude;
  final LatLng? avoid;

  /// Off in widget tests (no network there).
  final bool showTiles;

  @override
  ConsumerState<MapPointScreen> createState() => _MapPointScreenState();
}

class _MapPointScreenState extends ConsumerState<MapPointScreen> {
  final _map = MapController();
  final _search = TextEditingController();
  late LatLng _center;
  bool _searching = false;
  bool _locating = false;
  String? _message;
  bool _movedToArea = false;

  @override
  void initState() {
    super.initState();
    _center = widget.latitude != null && widget.longitude != null
        ? LatLng(widget.latitude!, widget.longitude!)
        : const LatLng(30.4167, 31.5667);
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _moveTo(double lat, double lng, {double zoom = 17}) {
    setState(() => _center = LatLng(lat, lng));
    _map.move(LatLng(lat, lng), zoom);
  }

  Future<void> _doSearch() async {
    final l10n = AppLocalizations.of(context);
    final q = _search.text.trim();
    if (q.length < 3) return;
    setState(() {
      _searching = true;
      _message = null;
    });
    try {
      final p = await ref.read(addressesApiProvider).searchAddress(q);
      if (!mounted) return;
      if (p == null) {
        setState(() => _message = l10n.addressSearchNoResult);
      } else {
        _moveTo(p.latitude, p.longitude);
      }
    } catch (_) {
      if (mounted) setState(() => _message = l10n.addressSearchNoResult);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _myLocation() async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _locating = true;
      _message = null;
    });
    try {
      final r = await ref.read(deviceLocationServiceProvider).getCurrentLocation();
      if (mounted) _moveTo(r.latitude, r.longitude);
    } catch (_) {
      if (mounted) setState(() => _message = l10n.addressLocationPositionUnavailable);
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final areas = ref.watch(serviceAreasProvider).valueOrNull ?? const <ServiceAreaCircle>[];
    // With no starting point, open over the served area rather than an arbitrary city centre.
    if (!_movedToArea && widget.latitude == null && areas.isNotEmpty) {
      _movedToArea = true;
      _center = LatLng(areas.first.centerLatitude, areas.first.centerLongitude);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _map.move(_center, 14);
      });
    }
    final inside = insideServiceAreas(areas, _center.latitude, _center.longitude);
    final avoid = widget.avoid;
    final same = avoid != null && distanceMeters(_center.latitude, _center.longitude, avoid.latitude, avoid.longitude) < samePlaceMeters;
    final blocker = !inside ? l10n.mapPointOutsideArea : (same ? l10n.mapPointSameAsOther : null);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.mapPointTitle)),
      body: Stack(children: [
        FlutterMap(
          key: const Key('map-point-map'),
          mapController: _map,
          options: MapOptions(
            initialCenter: _center,
            initialZoom: widget.latitude != null ? 17 : 14,
            onPositionChanged: (camera, hasGesture) {
              if (hasGesture) setState(() => _center = camera.center);
            },
          ),
          children: [
            if (widget.showTiles)
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'dev.hatly.customer',
              ),
            CircleLayer(circles: [
              for (final a in areas)
                CircleMarker(
                  point: LatLng(a.centerLatitude, a.centerLongitude),
                  radius: a.radiusMeters,
                  useRadiusInMeter: true,
                  color: p.accent.withValues(alpha: 0.06),
                  borderColor: p.accent,
                  borderStrokeWidth: 2,
                ),
            ]),
            const RichAttributionWidget(attributions: [TextSourceAttribution('OpenStreetMap contributors')]),
          ],
        ),
        // The pin stays in the middle; the MAP moves under it.
        IgnorePointer(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 40),
              child: Icon(Icons.location_on, size: 48, color: p.urgent),
            ),
          ),
        ),
        PositionedDirectional(
          top: HatlySpacing.sm,
          start: HatlySpacing.sm,
          end: HatlySpacing.sm,
          child: Material(
            elevation: 3,
            borderRadius: BorderRadius.circular(HatlyRadius.card),
            color: p.surface,
            child: Row(children: [
              Expanded(
                child: TextField(
                  key: const Key('map-point-search'),
                  controller: _search,
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _doSearch(),
                  decoration: InputDecoration(
                    hintText: l10n.addressSearchLabel,
                    prefixIcon: const Icon(Icons.search),
                    border: InputBorder.none,
                    contentPadding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                ),
              ),
              _searching
                  ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)))
                  : TextButton(key: const Key('map-point-search-go'), onPressed: _doSearch, child: Text(l10n.addressSearchAction)),
            ]),
          ),
        ),
        PositionedDirectional(
          end: HatlySpacing.md,
          bottom: 150,
          child: FloatingActionButton.small(
            key: const Key('map-point-my-location'),
            heroTag: 'map-point-my-location',
            tooltip: l10n.addressUseCurrentLocation,
            onPressed: _locating ? null : _myLocation,
            child: _locating ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.my_location),
          ),
        ),
        PositionedDirectional(
          start: 0,
          end: 0,
          bottom: 0,
          child: Material(
            elevation: 8,
            color: p.surface,
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.all(HatlySpacing.md),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text(l10n.mapPointHint, style: context.type.small),
                  if (_message != null) ...[
                    const SizedBox(height: HatlySpacing.xs),
                    Text(_message!, key: const Key('map-point-message'), style: context.type.small.copyWith(color: p.urgent)),
                  ],
                  if (blocker != null) ...[
                    const SizedBox(height: HatlySpacing.xs),
                    Text(blocker, key: const Key('map-point-blocker'), style: context.type.small.copyWith(color: p.urgent, fontWeight: FontWeight.w600)),
                  ],
                  const SizedBox(height: HatlySpacing.sm),
                  ElevatedButton(
                    key: const Key('map-point-confirm'),
                    style: hatlyAccentButtonStyle(context),
                    onPressed: blocker == null ? () => Navigator.of(context).pop(_center) : null,
                    child: Text(l10n.addressConfirmPin),
                  ),
                ]),
              ),
            ),
          ),
        ),
      ]),
    );
  }
}
