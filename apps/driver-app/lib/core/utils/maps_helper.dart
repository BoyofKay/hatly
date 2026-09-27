import 'package:url_launcher/url_launcher.dart';

/// CONFIRMED (locked decision): no internal map/navigation is built —
/// `google_maps_flutter` (already in pubspec.yaml from an earlier
/// phase) remains unused for this. Opens the universal
/// `google.com/maps` search URL, which every platform resolves to
/// its own installed maps app.
Future<bool> openInMaps({required double latitude, required double longitude}) {
  final uri = Uri.parse('https://www.google.com/maps/search/?api=1&query=$latitude,$longitude');
  return launchUrl(uri, mode: LaunchMode.externalApplication);
}
