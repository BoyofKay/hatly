/// Build-time API base URL (`--dart-define=API_BASE_URL=...`), read by the HTTP
/// client and validated at release startup (see [apiBaseUrlProblem]).
const String kApiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:3000/api/v1',
);

/// Why [baseUrl] must not be used by a RELEASE build, or null when it is acceptable.
///
/// The build-time default is `http://localhost:3000/api/v1` (convenient for local development). A release build that was
/// compiled without `--dart-define=API_BASE_URL=...` would ship pointing at the device itself and fail every request with a
/// confusing network error — so release startup refuses it loudly instead. LAN/staging/production URLs all pass; only an empty,
/// unparseable or this-device address is rejected (deliberately not a scheme check: developer LAN builds use plain http).
String? apiBaseUrlProblem(String baseUrl) {
  final uri = Uri.tryParse(baseUrl.trim());
  if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
    return 'API_BASE_URL is empty or not a valid URL.';
  }
  const thisDevice = {'localhost', '127.0.0.1', '::1', '0.0.0.0', '10.0.2.2'};
  if (thisDevice.contains(uri.host.toLowerCase())) {
    return 'API_BASE_URL points at the local machine (${uri.host}); '
        'rebuild with --dart-define=API_BASE_URL=<reachable backend URL>.';
  }
  return null;
}
