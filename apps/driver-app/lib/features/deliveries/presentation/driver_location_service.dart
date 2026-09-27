import 'dart:async';
import 'package:geolocator/geolocator.dart';

/// Sends the driver's location to the backend on a fixed interval while
/// online, rather than streaming continuous high-accuracy updates —
/// per spec section 9's explicit battery/privacy constraint.
///
/// PHASE I-A, CHUNK 5: the actual `PATCH driver/location` call is now
/// wired — see `DriverOnlineStateNotifier.setOnline()`
/// (data/driver_providers.dart), which supplies the `onLocation`
/// callback. Kept out of this class deliberately: this service only
/// ever knows about GPS, never about the API — the provider layer
/// owns that connection, matching this app's existing separation
/// between `DriverLocationService` (pure location) and `DriverApi`
/// (pure network).
class DriverLocationService {
  DriverLocationService({this.interval = const Duration(seconds: 20)});

  final Duration interval;
  Timer? _timer;

  void start(void Function(Position position) onLocation) {
    _timer?.cancel();
    _timer = Timer.periodic(interval, (_) async {
      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );
      onLocation(position);
    });
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }
}
