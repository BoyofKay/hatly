import '../config/api_config.dart';

/// Turns a backend-supplied media reference into a loadable absolute URL.
///
/// The backend stores uploaded/seeded media as a server-relative path
/// (`/uploads/files/<key>`), served from the API host's root (NOT under the
/// `/api/v1` prefix). A future object-storage/CDN provider will return
/// absolute `https://` URLs instead; both shapes are supported.
///
/// Returns null for anything that cannot be a real image reference (blank,
/// non-http(s) schemes such as `stub-upload://`, or a bare relative string)
/// so callers fall back to their placeholder instead of issuing a request
/// that is guaranteed to fail.
String? resolveMediaUrl(String? raw, {String apiBaseUrl = kApiBaseUrl}) {
  final value = raw?.trim();
  if (value == null || value.isEmpty) return null;

  final parsed = Uri.tryParse(value);
  if (parsed == null) return null;

  if (parsed.hasScheme) {
    final scheme = parsed.scheme.toLowerCase();
    return (scheme == 'http' || scheme == 'https') && parsed.host.isNotEmpty
        ? value
        : null;
  }

  if (!value.startsWith('/') || value.startsWith('//')) return null;

  final base = Uri.tryParse(apiBaseUrl);
  if (base == null || !base.hasScheme || base.host.isEmpty) return null;
  return base.replace(path: value, query: null, fragment: null).toString();
}
