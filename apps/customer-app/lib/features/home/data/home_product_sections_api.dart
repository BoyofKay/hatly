import '../../../core/network/api_client.dart';
import '../../products/data/api_product_repository.dart';
import '../../products/domain/product.dart';
import '../../vendors/data/api_vendor_repository.dart';
import '../../vendors/domain/vendor.dart';
import '../domain/home_content.dart';

/// The wire ids of the three Home product sections (`GET /home/product-sections`), mapped to the app's own [HomeSectionKind].
const _wireIds = <HomeSectionKind, String>{
  HomeSectionKind.offers: 'OFFERS',
  HomeSectionKind.mostOrdered: 'MOST_ORDERED',
  HomeSectionKind.newest: 'NEW',
};

/// One section as the server answered it: either its products (possibly none) or "unavailable" — the other sections are unaffected.
class HomeSectionPayload {
  const HomeSectionPayload.ok(this.products) : failed = false;
  const HomeSectionPayload.failed()
      : products = const [],
        failed = true;

  final List<Product> products;
  final bool failed;
}

class HomeProductSectionsResult {
  const HomeProductSectionsResult(
      {required this.vendors, required this.sections});

  /// The ranked source vendors (at most 6) — their offer flags feed the Offers row.
  final List<Vendor> vendors;

  /// Only the sections that were asked for (all three unless a retry named one).
  final Map<HomeSectionKind, HomeSectionPayload> sections;
}

/// `GET /home/product-sections` — ONE public request for the three Home product rows (it replaces the three vendor-list requests plus
/// eighteen per-vendor product requests). A section the server could not produce arrives as `status: ERROR`; it is reported as failed
/// for that section only. An item the app cannot parse is dropped, never thrown, so one bad product cannot cost the whole row.
class HomeProductSectionsApi {
  HomeProductSectionsApi(this._client);

  final ApiClient _client;

  Future<HomeProductSectionsResult> fetch({Set<HomeSectionKind>? sections}) {
    return _client.request(
      (dio) => dio.get(
        '/home/product-sections',
        queryParameters: {
          if (sections != null && sections.isNotEmpty)
            'sections': sections.map((k) => _wireIds[k]).join(','),
        },
      ),
      (data) => parse(data),
    );
  }

  static HomeProductSectionsResult parse(dynamic data) {
    final body = (data as Map)['data'] as Map<String, dynamic>;
    final vendors = <Vendor>[
      for (final raw in (body['vendors'] as List? ?? const []))
        if (_tryParse(() =>
                ApiVendorRepository.vendorFromJson(raw as Map<String, dynamic>))
            case final v?)
          v,
    ];
    final sections = <HomeSectionKind, HomeSectionPayload>{};
    for (final raw in (body['sections'] as List? ?? const [])) {
      final map = raw as Map<String, dynamic>;
      final kind = _wireIds.entries
          .where((e) => e.value == map['id'])
          .map((e) => e.key)
          .firstOrNull;
      if (kind == null)
        continue; // a section id this app version does not know: ignored
      if (map['status'] != 'OK') {
        sections[kind] = const HomeSectionPayload.failed();
        continue;
      }
      sections[kind] = HomeSectionPayload.ok([
        for (final item in (map['products'] as List? ?? const []))
          if (_tryParse(() => ApiProductRepository.productFromJson(
                  item as Map<String, dynamic>))
              case final p?)
            p,
      ]);
    }
    return HomeProductSectionsResult(vendors: vendors, sections: sections);
  }

  static T? _tryParse<T>(T Function() parse) {
    try {
      return parse();
    } catch (_) {
      return null;
    }
  }
}
