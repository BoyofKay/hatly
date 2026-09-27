import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/catalog/domain/catalog_product.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/features/search/data/search_api.dart';

/// Parsing tests against hand-built maps shaped exactly like the backend responses of
/// `GET /products?sectorId=`, `GET /catalog-products/:id`, `GET /products/:id` and `GET /search`
/// (see `test/e2e/35-catalog-products.e2e-spec.ts` on the backend, which pins those shapes).
void main() {
  group('CatalogProductSummary / CatalogProductPage (GET /products?sectorId=)',
      () {
    test(
        'a grouped catalog item: catalogProductId set, no listingId, storeCount > 1',
        () {
      final page = CatalogProductPage.fromJson({
        'data': [
          {
            'catalogProductId': 'cat-1',
            'listingId': null,
            'name': 'Cola 1.25L',
            'nameAr': 'كولا',
            'imageUrl': 'https://img.test/cola.png',
            'brand': 'Cola Co',
            'pricingUnit': 'PIECE',
            'fromPriceMinor': 2500,
            'storeCount': 3,
            'hasOffer': true,
          },
        ],
        'meta': {'page': 1, 'limit': 20, 'total': 45},
      });
      final item = page.data.single;
      expect(item.isLinked, isTrue);
      expect(item.catalogProductId, 'cat-1');
      expect(item.listingId, isNull);
      expect(item.fromPriceMinor, 2500);
      expect(item.storeCount, 3);
      expect(item.hasOffer, isTrue);
      expect(item.brand, 'Cola Co');
      expect(page.hasMore, isTrue, reason: '1 × 20 < 45');
    });

    test(
        'an unlinked listing is its own item: catalogProductId null, listingId = product id',
        () {
      final item = CatalogProductSummary.fromJson({
        'catalogProductId': null,
        'listingId': 'prod-9',
        'name': 'Rice',
        'nameAr': null,
        'imageUrl': null,
        'brand': null,
        'pricingUnit': 'WEIGHT',
        'fromPriceMinor': 6000,
        'storeCount': 1,
        'hasOffer': false,
      });
      expect(item.isLinked, isFalse);
      expect(item.listingId, 'prod-9');
      expect(item.isWeighted, isTrue);
      expect(item.storeCount, 1);
    });

    test(
        'numbers arriving as doubles / strings-free JSON numbers still parse; last page has no more',
        () {
      final page = CatalogProductPage.fromJson({
        'data': <dynamic>[],
        'meta': {'page': 3, 'limit': 20.0, 'total': 41.0},
      });
      expect(page.hasMore, isFalse, reason: '3 × 20 >= 41');
      expect(page.data, isEmpty);
    });
  });

  group('CatalogProductDetails / VendorListing (GET /catalog-products/:id)',
      () {
    final json = {
      'id': 'cat-1',
      'name': 'Selector Cola',
      'nameAr': 'كولا',
      'description': 'Cold',
      'descriptionAr': null,
      'imageUrl': null,
      'brand': 'Cola Co',
      'pricingUnit': 'PIECE',
      'storeCount': 2,
      'listings': [
        {
          'listingId': 'l-2',
          'vendorBranchId': 'b-2',
          'vendor': {
            'id': 'v-2',
            'name': 'Market Two',
            'nameAr': null,
            'logoUrl': null
          },
          'branchName': 'Market Two Main',
          'isOpen': true,
          'ratingAverage': 4.5,
          'ratingCount': 4,
          'priceMinor': 2600,
          'pricingUnit': 'PIECE',
          'activeOffer': null,
          'isAvailable': true,
          'inventoryMode': 'OPEN',
          'quantity': null,
        },
        {
          'listingId': 'l-1',
          'vendorBranchId': 'b-1',
          'vendor': {
            'id': 'v-1',
            'name': 'Market One',
            'nameAr': 'ماركت',
            'logoUrl': 'https://img.test/logo.png'
          },
          'branchName': 'Market One Main',
          'isOpen': false,
          'ratingAverage': 0,
          'ratingCount': 0,
          'priceMinor': 3100,
          'pricingUnit': 'PIECE',
          'activeOffer': {'mechanism': 'FLASH_SALE', 'specialPriceMinor': 2400},
          'isAvailable': true,
          'inventoryMode': 'TRACKED',
          'quantity': 4,
        },
      ],
    };

    test(
        'parses the identity and the vendor listings in the order the API returned them (price ascending)',
        () {
      final details = CatalogProductDetails.fromJson(json);
      expect(details.name, 'Selector Cola');
      expect(details.storeCount, 2);
      expect(details.listings.map((l) => l.listingId), ['l-2', 'l-1']);
    });

    test(
        'a listing carries real branch rating, price, inventory and its offer; no ETA / delivery fee exist',
        () {
      final listings = CatalogProductDetails.fromJson(json).listings;
      final open = listings.first;
      expect(open.vendor.name, 'Market Two');
      expect(open.isOpen, isTrue);
      expect(open.ratingAverage, 4.5);
      expect(open.ratingCount, 4);
      expect(open.priceMinor, 2600);
      expect(open.activeOffer, isNull);
      expect(open.isTracked, isFalse);
      expect(open.quantity, isNull);

      final flash = listings.last;
      expect(flash.isOpen, isFalse);
      expect(flash.ratingAverage, 0, reason: 'no ratings → 0, never invented');
      expect(flash.activeOffer!.isFlashSale, isTrue);
      expect(flash.activeOffer!.specialPriceMinor, 2400);
      expect(flash.isTracked, isTrue);
      expect(flash.quantity, 4);
      expect(flash.vendor.logoUrl, 'https://img.test/logo.png');
    });

    test('a catalog product with no orderable listings parses to an empty list',
        () {
      final details = CatalogProductDetails.fromJson({
        ...json,
        'storeCount': 0,
        'listings': <dynamic>[],
      });
      expect(details.listings, isEmpty);
      expect(details.storeCount, 0);
    });
  });

  group('existing models stay compatible', () {
    test('ProductVendorSummary parses the vendor block of GET /products/:id',
        () {
      final v = ProductVendorSummary.fromJson({
        'id': 'v-1',
        'vendorBranchId': 'b-1',
        'name': 'Market One',
        'nameAr': null,
        'logoUrl': null,
        'branchName': 'Market One Main',
        'isOpen': true,
        'ratingAverage': 4.25,
        'ratingCount': 8,
      });
      expect(v.vendorBranchId, 'b-1');
      expect(v.ratingAverage, 4.25);
      expect(v.ratingCount, 8);
    });

    test('a Product built the old way has null catalogProductId / vendor', () {
      const p = Product(
        id: 'p1',
        vendorBranchId: 'b1',
        categoryId: 'c1',
        name: 'Burger',
        priceMinor: 9000,
        isAvailable: true,
      );
      expect(p.catalogProductId, isNull);
      expect(p.vendor, isNull);
      expect(p.id, 'p1', reason: 'the listing id is still the product id');
    });

    test(
        'SearchProductResult reads the additive catalogProductId (null when absent)',
        () {
      Map<String, dynamic> base() => {
            'id': 'sp1',
            'vendorBranchId': 'b1',
            'name': 'Cheese Burger',
            'nameAr': null,
            'imageUrl': null,
            'priceMinor': 8500,
            'pricingUnit': 'PIECE',
            'inventoryMode': 'OPEN',
            'quantity': null,
            'isAvailable': true,
            'vendorName': 'Burger House',
            'vendorNameAr': null,
            'vendorLogoUrl': null,
            'activeOffer': null,
          };
      final withoutField = SearchProductResult.fromJson(base());
      expect(withoutField.catalogProductId, isNull);
      final linked = SearchProductResult.fromJson(
          {...base(), 'catalogProductId': 'cat-1'});
      expect(linked.catalogProductId, 'cat-1');
      expect(linked.id, 'sp1');
    });
  });
}
