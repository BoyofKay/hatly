import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/network/providers.dart';
import '../domain/route_endpoint.dart';

class HatlyServiceApi {
  HatlyServiceApi(this._client);
  final ApiClient _client;

  /// The voice-note limit set in Admin → Settings (owner 2026-11-28), in seconds. Null = not known (older server): the app uses 5 minutes.
  Future<int?> getVoiceNoteMaxSeconds() async {
    try {
      return await _client.request(
        (dio) => dio.get('/hatly-service/voice-note-limit'),
        (data) => ((data['data'] as Map<String, dynamic>)['maxSeconds'] as num?)?.toInt(),
      );
    } catch (_) {
      return null;
    }
  }

  /// The configured Hatly / Wasally default route endpoints. A backend that predates the endpoint (404) answers "nothing configured".
  Future<RouteDefaults> getRouteDefaults() async {
    try {
      return await _client.request(
        (dio) => dio.get('/hatly-service/route-defaults'),
        (data) => RouteDefaults.fromJson(data['data'] as Map<String, dynamic>),
      );
    } on ApiException catch (e) {
      if (e.code == 'NOT_FOUND' || e.statusCode == 404) return RouteDefaults.none;
      rethrow;
    }
  }
}

final hatlyServiceApiProvider = Provider<HatlyServiceApi>(
    (ref) => HatlyServiceApi(ref.watch(apiClientProvider)));

final routeDefaultsProvider = FutureProvider.autoDispose<RouteDefaults>(
    (ref) => ref.watch(hatlyServiceApiProvider).getRouteDefaults());
