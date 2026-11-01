import '../../../core/network/api_client.dart';
import '../domain/home_banner.dart';

/// `GET /home-banners` — public; the server returns only banners that are published, inside their schedule, with a working
/// destination, in the admin's order (at most 10). One malformed item is skipped; it never costs the customer the others.
class HomeBannersApi {
  HomeBannersApi(this._client);

  final ApiClient _client;

  Future<List<HomeBanner>> getBanners() {
    return _client.request(
      (dio) => dio.get('/home-banners'),
      (data) {
        final raw = data['data'];
        if (raw is! List) return const <HomeBanner>[];
        return [
          for (final item in raw)
            if (HomeBanner.tryParse(item) case final banner?) banner,
        ];
      },
    );
  }
}
