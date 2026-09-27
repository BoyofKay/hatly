import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/home/data/home_providers.dart';
import 'package:hatly_customer/features/home/domain/home_content.dart';
import 'package:hatly_customer/features/home/presentation/widgets/home_promo_actions.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/features/sectors/domain/sector.dart';
import 'package:hatly_customer/features/vendors/domain/vendor.dart';

MarketplaceSector sector(String slug, int order, {String? name}) =>
    MarketplaceSector(
        id: 'id-$slug', name: name ?? slug, slug: slug, sortOrder: order);

Vendor vendor(String id,
        {int count = 10, double rating = 4.0, bool promo = false}) =>
    Vendor(
      id: id,
      name: 'V $id',
      category: '',
      ratingAverage: rating,
      ratingCount: count,
      etaMinMinutes: 0,
      etaMaxMinutes: 0,
      deliveryFeeMinor: 0,
      isOpen: true,
      hasPromotion: promo,
    );

Product product(String id, {ActiveOffer? offer, int price = 10000}) => Product(
      id: id,
      vendorBranchId: 'b',
      categoryId: 'c',
      name: 'P $id',
      priceMinor: price,
      isAvailable: true,
      activeOffer: offer,
    );

void main() {
  group('category ordering is data-driven and configurable', () {
    test(
        'orders by backend sortOrder (name breaks ties) — nothing is hard-coded',
        () {
      final ordered = orderHomeCategories([
        sector('c', 3),
        sector('a', 1),
        sector('b', 2),
        sector('z', 1, name: 'zz')
      ], pinnedSlugs: const []);
      expect(ordered.map((s) => s.slug), ['a', 'z', 'b', 'c']);
    });

    test(
        'pinned slugs come first, in the configured order, then the rest by sortOrder',
        () {
      final ordered = orderHomeCategories(
          [sector('a', 1), sector('b', 2), sector('c', 3), sector('d', 4)],
          pinnedSlugs: const ['d', 'b']);
      expect(ordered.map((s) => s.slug), ['d', 'b', 'a', 'c']);
    });

    test('an unknown pinned slug is ignored and the list is capped at 12', () {
      final many = [for (var i = 0; i < 20; i++) sector('s$i', i)];
      final ordered = orderHomeCategories(many, pinnedSlugs: const ['nope']);
      expect(ordered, hasLength(12));
      expect(ordered.first.slug, 's0');
    });

    test('a sector may carry an image url; it is optional', () {
      final s = MarketplaceSector.fromJson({
        'id': '1',
        'name': 'x',
        'slug': 'x',
        'sortOrder': 1,
        'imageUrl': 'https://img/x.png'
      });
      expect(s.imageUrl, 'https://img/x.png');
      expect(
          MarketplaceSector.fromJson(
              {'id': '1', 'name': 'x', 'slug': 'x', 'sortOrder': 1}).imageUrl,
          isNull);
    });
  });

  group('popular vendors', () {
    test('most reviewed first, then best rated; de-duplicated; exactly 4', () {
      final ranked = rankPopularVendors([
        vendor('a', count: 5, rating: 5),
        vendor('b', count: 50, rating: 3),
        vendor('b',
            count: 50, rating: 3), // duplicate from another sector query
        vendor('c', count: 50, rating: 4.5),
        vendor('d', count: 7),
        vendor('e', count: 1),
      ]);
      expect(ranked.map((v) => v.id), ['c', 'b', 'd', 'a']);
    });
  });

  group('offers are derived from existing data only', () {
    test(
        'a flash-sale product becomes a flash card with the special price and the original struck through',
        () {
      final offers = buildOffers(
        vendors: const [],
        products: [
          HomeProductEntry(
              product: product('p1',
                  price: 10000,
                  offer: const ActiveOffer(
                      mechanism: 'FLASH_SALE', specialPriceMinor: 7000)),
              tag: HomeProductTag.popular)
        ],
      );
      expect(offers.single.kind, HomeOfferKind.flash);
      expect(offers.single.priceMinor, 7000);
      expect(offers.single.originalPriceMinor, 10000);
      expect(offers.single.targetId, 'p1');
    });

    test(
        'a non-flash active offer is a product offer; a product without an offer contributes nothing',
        () {
      final offers = buildOffers(
        vendors: const [],
        products: [
          HomeProductEntry(
              product: product('p1',
                  offer: const ActiveOffer(mechanism: 'SUBTOTAL_DISCOUNT')),
              tag: HomeProductTag.newItem),
          HomeProductEntry(product: product('p2'), tag: HomeProductTag.popular),
        ],
      );
      expect(offers.map((o) => (o.kind, o.originalPriceMinor)),
          [(HomeOfferKind.product, null)]);
    });

    test(
        'a vendor with a promotion becomes a vendor offer; a vendor without one does not; free-delivery/bundle are never invented',
        () {
      final offers = buildOffers(
          vendors: [vendor('v1', promo: true), vendor('v2')],
          products: const []);
      expect(offers.map((o) => o.kind), [HomeOfferKind.vendor]);
      expect(
          offers.any((o) =>
              o.kind == HomeOfferKind.freeDelivery ||
              o.kind == HomeOfferKind.bundle),
          isFalse);
    });

    test(
        'promos come from the same offers: vendor offer → vendor promo, everything else → offer promo',
        () {
      final promos = buildPromos([
        const HomeOffer(
            id: 'a', kind: HomeOfferKind.flash, title: 'A', targetId: 'p'),
        const HomeOffer(
            id: 'b', kind: HomeOfferKind.vendor, title: 'B', targetId: 'v'),
      ]);
      expect(promos.map((p) => p.kind),
          [HomePromoKind.offer, HomePromoKind.vendor]);
    });
  });

  group('actions use existing routes only', () {
    test(
        'offers lead to the product page or the vendor page; demo/unknown targets fall back to Explore / vendor list',
        () {
      expect(
          offerRoute(const HomeOffer(
              id: '1', kind: HomeOfferKind.flash, title: 't', targetId: 'p9')),
          '/products/p9');
      expect(
          offerRoute(const HomeOffer(
              id: '1', kind: HomeOfferKind.vendor, title: 't', targetId: 'v9')),
          '/vendors/v9');
      expect(
          offerRoute(const HomeOffer(
              id: '1',
              kind: HomeOfferKind.freeDelivery,
              title: 't',
              targetId: 'demo-vendor-1')),
          '/vendors');
      expect(
          offerRoute(const HomeOffer(
              id: '1',
              kind: HomeOfferKind.product,
              title: 't',
              targetId: null)),
          '/search');
    });

    test('promo destinations per kind', () {
      String route(HomePromoKind k, String? id) =>
          promoRoute(HomePromo(id: 'x', kind: k, title: 't', targetId: id));
      expect(route(HomePromoKind.product, 'p1'), '/products/p1');
      expect(route(HomePromoKind.offer, 'p1'), '/products/p1');
      expect(route(HomePromoKind.vendor, 'v1'), '/vendors/v1');
      expect(route(HomePromoKind.freeDelivery, 'v1'), '/vendors/v1');
      expect(route(HomePromoKind.bundle, null), '/vendors');
    });
  });
}
