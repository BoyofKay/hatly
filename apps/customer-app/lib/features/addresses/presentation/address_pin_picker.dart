import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/location/device_location_service.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_key_value_row.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../data/addresses_providers.dart';

/// Whether the interactive map may be built. The native projects now READ a Maps SDK key when one is configured (iOS
/// `Local.xcconfig` / Android `local.properties`'s `MAPS_API_KEY` — see docs/PRODUCT_DECISIONS.md "Google Maps key
/// architecture"), but this repository ships with none set, and building a `GoogleMap` with no key registered still
/// crashes. So the map stays OFF unless the build is made with `--dart-define=HATLY_MAPS_ENABLED=true` — set that only
/// once a real key has been configured natively; otherwise the picker falls back to GPS + address search, which still
/// produce a real, server-validated pin.
class HatlyMaps {
  HatlyMaps._();

  static const bool enabled = bool.fromEnvironment('HATLY_MAPS_ENABLED');

  /// Only where the camera starts when nothing else is known (no GPS, no saved point); never used as an address.
  static const LatLng startingView = LatLng(30.0444, 31.2357);
}

typedef PinChanged = void Function(double latitude, double longitude);

/// Picks the delivery location: the map pin is the authoritative point (the address text is only an assistive suggestion).
/// With the map enabled the customer drags the map under a centre pin; otherwise they use their current location or search
/// for an address, and the resulting point is confirmed back to them.
class AddressPinPicker extends ConsumerStatefulWidget {
  const AddressPinPicker({
    super.key,
    this.latitude,
    this.longitude,
    required this.onChanged,
    this.mapEnabled = HatlyMaps.enabled,
  });

  final double? latitude;
  final double? longitude;
  final PinChanged onChanged;

  /// Overridable so tests can exercise both modes without a native map.
  final bool mapEnabled;

  @override
  ConsumerState<AddressPinPicker> createState() => _AddressPinPickerState();
}

class _AddressPinPickerState extends ConsumerState<AddressPinPicker> {
  final _search = TextEditingController();
  GoogleMapController? _map;
  LatLng? _cameraCenter;
  bool _locating = false;
  bool _searching = false;
  String? _message;
  bool _offerSettings = false;

  bool get _hasPoint => widget.latitude != null && widget.longitude != null;

  @override
  void dispose() {
    _search.dispose();
    _map?.dispose();
    super.dispose();
  }

  Future<void> _useCurrentLocation() async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _locating = true;
      _message = null;
      _offerSettings = false;
    });
    try {
      final result =
          await ref.read(deviceLocationServiceProvider).getCurrentLocation();
      widget.onChanged(result.latitude, result.longitude);
      await _map?.animateCamera(
          CameraUpdate.newLatLng(LatLng(result.latitude, result.longitude)));
    } on LocationUnavailableException catch (e) {
      // Each of the 5 states (not yet asked / granted / denied / permanently denied / services off) gets its OWN message —
      // never a single generic one — and "permanently denied" additionally offers the one recovery path that still works:
      // the device's own Settings app (the OS will not show its own prompt again).
      if (mounted) {
        setState(() {
          _message = _reasonMessage(l10n, e.reason);
          _offerSettings = e.canOpenSettings;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _message = l10n.somethingWentWrong);
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  String _reasonMessage(AppLocalizations l10n, LocationUnavailableReason reason) {
    switch (reason) {
      case LocationUnavailableReason.servicesDisabled:
        return l10n.addressLocationServicesDisabled;
      case LocationUnavailableReason.denied:
        return l10n.addressLocationPermissionDenied;
      case LocationUnavailableReason.permanentlyDenied:
        return l10n.addressLocationPermissionPermanentlyDenied;
      case LocationUnavailableReason.positionUnavailable:
        return l10n.addressLocationPositionUnavailable;
    }
  }

  Future<void> _searchAddress() async {
    final l10n = AppLocalizations.of(context);
    final query = _search.text.trim();
    if (query.length < 3) return;
    setState(() {
      _searching = true;
      _message = null;
    });
    try {
      final point = await ref.read(addressesApiProvider).searchAddress(query);
      if (!mounted) return;
      if (point == null) {
        setState(() => _message = l10n.addressSearchNoResult);
      } else {
        widget.onChanged(point.latitude, point.longitude);
        await _map?.animateCamera(
            CameraUpdate.newLatLng(LatLng(point.latitude, point.longitude)));
      }
    } catch (_) {
      if (mounted) setState(() => _message = l10n.addressSearchNoResult);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;

    final start = _hasPoint
        ? LatLng(widget.latitude!, widget.longitude!)
        : HatlyMaps.startingView;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.mapEnabled)
          ClipRRect(
            borderRadius: BorderRadius.circular(HatlyRadius.card),
            child: SizedBox(
              height: 240,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  GoogleMap(
                    key: const Key('address-map'),
                    initialCameraPosition:
                        CameraPosition(target: start, zoom: _hasPoint ? 17 : 12),
                    myLocationButtonEnabled: false,
                    zoomControlsEnabled: false,
                    onMapCreated: (c) => _map = c,
                    onCameraMove: (pos) => _cameraCenter = pos.target,
                    onCameraIdle: () {
                      final c = _cameraCenter;
                      if (c != null) widget.onChanged(c.latitude, c.longitude);
                    },
                  ),
                  // The pin stays in the middle; the MAP moves under it.
                  IgnorePointer(
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 36),
                      child: Icon(Icons.location_on, size: 44, color: p.urgent),
                    ),
                  ),
                ],
              ),
            ),
          )
        else
          HatlySurface(
            key: const Key('address-no-map'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.map_outlined, color: p.textMuted),
                    const SizedBox(width: HatlySpacing.ms),
                    Expanded(
                        child: Text(l10n.addressMapUnavailable,
                            style: context.type.small)),
                  ],
                ),
                const SizedBox(height: HatlySpacing.md),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('address-search-field'),
                        controller: _search,
                        textInputAction: TextInputAction.search,
                        onSubmitted: (_) => _searchAddress(),
                        decoration: InputDecoration(
                          labelText: l10n.addressSearchLabel,
                          prefixIcon: const Icon(Icons.search),
                        ),
                      ),
                    ),
                    const SizedBox(width: HatlySpacing.sm),
                    SizedBox(
                      height: 48,
                      child: OutlinedButton(
                        key: const Key('address-search-button'),
                        style: OutlinedButton.styleFrom(
                            minimumSize: const Size(72, 48)),
                        onPressed: _searching ? null : _searchAddress,
                        child: _searching
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2))
                            : Text(l10n.addressSearchAction),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        if (widget.mapEnabled) ...[
          const SizedBox(height: HatlySpacing.sm),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              key: const Key('address-confirm-pin'),
              style: hatlyAccentButtonStyle(context),
              onPressed: () {
                final c = _cameraCenter ?? start;
                widget.onChanged(c.latitude, c.longitude);
              },
              child: Text(l10n.addressConfirmPin),
            ),
          ),
        ],
        const SizedBox(height: HatlySpacing.sm),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            key: const Key('address-use-current-location'),
            onPressed: _locating ? null : _useCurrentLocation,
            icon: _locating
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.my_location),
            label: Text(l10n.addressUseCurrentLocation),
          ),
        ),
        if (_message != null)
          Padding(
            padding: const EdgeInsets.only(top: HatlySpacing.sm),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_message!,
                    key: const Key('address-picker-message'),
                    style: context.type.small.copyWith(color: p.urgent)),
                if (_offerSettings)
                  Padding(
                    padding: const EdgeInsets.only(top: HatlySpacing.xs),
                    child: TextButton(
                      key: const Key('address-open-settings'),
                      onPressed: () =>
                          ref.read(deviceLocationServiceProvider).openAppSettings(),
                      child: Text(l10n.addressOpenSettings),
                    ),
                  ),
              ],
            ),
          ),
        if (_hasPoint)
          Padding(
            padding: const EdgeInsets.only(top: HatlySpacing.sm),
            child: Row(
              children: [
                Icon(Icons.check_circle, size: 18, color: p.success),
                const SizedBox(width: HatlySpacing.sm),
                Expanded(
                  child: Text(l10n.addressLocationCaptured,
                      key: const Key('address-location-captured'),
                      style: context.type.small.copyWith(color: p.success)),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
