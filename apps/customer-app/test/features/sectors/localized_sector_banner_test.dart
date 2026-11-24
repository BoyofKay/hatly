import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/sectors/domain/sector.dart';

void main() {
  MarketplaceSector sector(String? en, String? ar) => MarketplaceSector.fromJson({
    'id': 's1', 'name': 'Sector', 'nameAr': 'قطاع', 'slug': 'sector', 'sortOrder': 1,
    'bannerUrl': en, 'bannerUrlAr': ar,
  });
  test('uses independently authored artwork for each language', () {
    final s = sector('en.png', 'ar.png');
    expect(s.localizedBanner(arabic: false), 'en.png');
    expect(s.localizedBanner(arabic: true), 'ar.png');
  });
  test('existing and missing images fall back safely', () {
    expect(sector('legacy.png', null).localizedBanner(arabic: true), 'legacy.png');
    expect(sector(null, 'ar.png').localizedBanner(arabic: false), 'ar.png');
    expect(sector(null, '').localizedBanner(arabic: true), isNull);
  });
}
