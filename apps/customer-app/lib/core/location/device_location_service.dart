import 'package:geolocator/geolocator.dart';

/// CONFIRMED (Checkout / Address chunk): device GPS only — no
/// reverse-geocoding service exists in this project and none is added
/// here. This returns raw latitude/longitude; the human-readable
/// address text is always supplied/edited by the customer themselves
/// (see the Saved Address form) — never derived automatically from
/// coordinates.
class DeviceLocationResult {
  const DeviceLocationResult({required this.latitude, required this.longitude});
  final double latitude;
  final double longitude;
}

/// Every way "use my current location" can fail to produce a real coordinate — never invented as a substitute. The address
/// picker (production-readiness slice) shows each distinctly and offers "Open Settings" for the one recoverable-only-outside-
/// the-app case ([permanentlyDenied]).
enum LocationUnavailableReason {
  /// Location services are off at the OS level (Settings > Location, or the device's physical switch).
  servicesDisabled,

  /// The customer has not been asked yet, or was asked and said no — asking again (a retry) can still succeed.
  denied,

  /// The customer said "don't ask again" (iOS) or denied it twice (Android) — the OS will not show its own prompt again;
  /// only the device's own Settings app can change this.
  permanentlyDenied,

  /// Permission is granted and services are on, but the OS still failed to produce a fix (timeout, no signal, disabled per-app
  /// precise location, or any other Geolocator-reported error).
  positionUnavailable,
}

/// Thrown when location services are disabled or permission is denied
/// — the caller (the address form) shows this as a clear message and
/// falls back to manual entry; GPS coordinates are never fabricated as
/// a substitute.
class LocationUnavailableException implements Exception {
  const LocationUnavailableException(this.message, this.reason);
  final String message;
  final LocationUnavailableReason reason;

  bool get canOpenSettings => reason == LocationUnavailableReason.permanentlyDenied;
}

class DeviceLocationService {
  const DeviceLocationService();

  /// Requests permission if needed, then returns the current GPS fix.
  /// Throws [LocationUnavailableException] if location services are
  /// off or permission is denied/permanently denied — never returns a
  /// fabricated coordinate.
  Future<DeviceLocationResult> getCurrentLocation() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      throw const LocationUnavailableException(
        'Location services are turned off on this device.',
        LocationUnavailableReason.servicesDisabled,
      );
    }

    // Not yet requested, or previously said no: ask (again) — a retry can still succeed.
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        throw const LocationUnavailableException(
          'Location permission was denied.',
          LocationUnavailableReason.denied,
        );
      }
    }
    if (permission == LocationPermission.deniedForever) {
      throw const LocationUnavailableException(
        'Location permission is permanently denied — enable it from device settings.',
        LocationUnavailableReason.permanentlyDenied,
      );
    }

    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      return DeviceLocationResult(
          latitude: position.latitude, longitude: position.longitude);
    } on Exception {
      // Permission and services were both fine — this is Geolocator itself failing to produce a fix (timeout, no signal…).
      // Never invented as a substitute; the customer still has the search box and manual fields.
      throw const LocationUnavailableException(
        'Could not determine your current location.',
        LocationUnavailableReason.positionUnavailable,
      );
    }
  }

  /// Opens the device's own Settings app to this app's page — the only recovery path once permission is
  /// [LocationUnavailableReason.permanentlyDenied] (the OS will not show its own prompt again).
  Future<bool> openAppSettings() => Geolocator.openAppSettings();
}
