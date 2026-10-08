import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/sectors/domain/subcategory.dart';

/// Mirrors the real `GET /sectors/:sectorId/subcategories` response
/// shape field-for-field.
void main() {
  group('MarketplaceSubcategory.fromJson', () {
    test('parses every field, including the optional ones', () {
      final subcategory = MarketplaceSubcategory.fromJson({
        'id': 'sc1',
        'name': 'Burgers',
        'nameAr': 'برجر',
        'sortOrder': 2,
        'imageUrl': 'https://cdn.hatly.example/subcategories/burgers.png',
      });
      expect(subcategory.id, 'sc1');
      expect(subcategory.name, 'Burgers');
      expect(subcategory.nameAr, 'برجر');
      expect(subcategory.sortOrder, 2);
      expect(subcategory.imageUrl,
          'https://cdn.hatly.example/subcategories/burgers.png');
    });

    test('reads nameAr/imageUrl defensively — both are genuinely optional', () {
      final subcategory = MarketplaceSubcategory.fromJson({
        'id': 'sc2',
        'name': 'Pizza',
        'sortOrder': 0,
      });
      expect(subcategory.nameAr, isNull);
      expect(subcategory.imageUrl, isNull);
    });
  });
}
