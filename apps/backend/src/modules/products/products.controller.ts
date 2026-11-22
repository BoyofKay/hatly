import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { Public } from '../../common/decorators/public.decorator';
import { ProductsService } from './products.service';
import { OfferConsumptionService } from '../offers/offer-consumption.service';

/**
 * CONFIRMED (Discovery & Ranking, decision 9): extends the existing
 * vendor-menu endpoint rather than creating a parallel one.
 *
 * Filters V1 additions: `availableOnly`/`hasOffers`/`minPriceMinor`/
 * `maxPriceMinor`, plus `'offers'` added to `sort` — all optional,
 * backward compatible (omitting every one reproduces the exact
 * pre-Filters-V1 behavior). Boolean query params use this codebase's
 * established `?value === 'true' : value === 'false' : value` string
 * -> boolean `@Transform`, same as `ListCatalogProductsQueryDto`/
 * `SearchAdminCustomersQueryDto`.
 */
export class ListProductsQueryDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsIn(['highestRated', 'bestSelling', 'newest', 'price_asc', 'price_desc', 'offers'])
  sort?: 'highestRated' | 'bestSelling' | 'newest' | 'price_asc' | 'price_desc' | 'offers';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  availableOnly?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  hasOffers?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPriceMinor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceMinor?: number;
}

/**
 * Catalog reads only — no writes. Vendor/admin-side product management
 * (creating/editing products) is out of scope for this phase; these
 * endpoints exist purely so the customer app's Vendor Details / Product
 * Details screens (currently fixture-backed, Phase 2C) have a real API
 * to switch to.
 *
 * Public (no auth) — browsing a menu shouldn't require login, matching
 * how vendor listing itself will work once GET /vendors exists.
 */
@ApiTags('products')
@Controller()
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly offerConsumptionService: OfferConsumptionService,
  ) {}

  /**
   * L1-B addition. Public — same reasoning as the other two
   * `vendor-branches/:...` routes below: browsing a vendor's details
   * shouldn't require login. No route collision with
   * `vendor-branches/:branchId/categories`/`products` — different path
   * shape (one segment after the prefix here vs. two on those), so
   * NestJS/Express route matching never confuses them.
   */
  @Public()
  @Get('vendor-branches/:id')
  async getBranchDetails(@Param('id') id: string) {
    const details = await this.productsService.getBranchDetails(id);
    return { data: details };
  }

  @Public()
  @Get('vendor-branches/:branchId/categories')
  async getCategories(@Param('branchId') branchId: string) {
    const categories = await this.productsService.getCategories(branchId);
    return { data: categories };
  }

  @Public()
  @Get('vendor-branches/:branchId/products')
  async getProducts(@Param('branchId') branchId: string, @Query() query: ListProductsQueryDto) {
    const result = await this.productsService.getProducts(branchId, {
      categoryId: query.categoryId,
      sort: query.sort,
      search: query.search,
      page: query.page,
      limit: query.limit,
      availableOnly: query.availableOnly,
      hasOffers: query.hasOffers,
      minPriceMinor: query.minPriceMinor,
      maxPriceMinor: query.maxPriceMinor,
    });

    // Customer Product-Level Offers Display. ONE batch resolution for
    // the whole page — CONFIRMED never a per-product Offer query.
    const offersByProductId = await this.offerConsumptionService.resolveActiveOffersForProducts({
      vendorBranchId: branchId,
      products: result.data.map((p) => ({ productId: p.id, categoryId: p.categoryId, priceMinor: p.priceMinor, pricingUnit: p.pricingUnit })),
    });
    const data = result.data.map((product) => ({
      ...product,
      activeOffer: offersByProductId.get(product.id) ?? null,
    }));

    return { data, meta: { page: result.page, limit: result.limit, total: result.total } };
  }

  @Public()
  @Get('products/:id')
  async getProductById(@Param('id') id: string) {
    const product = await this.productsService.getProductById(id);
    const offersByProductId = await this.offerConsumptionService.resolveActiveOffersForProducts({
      vendorBranchId: product.vendorBranchId,
      products: [{ productId: product.id, categoryId: product.categoryId, priceMinor: product.priceMinor, pricingUnit: product.pricingUnit }],
    });
    const extras = await this.productsService.getPublicExtras(product);
    return { data: { ...product, activeOffer: offersByProductId.get(product.id) ?? null, ...extras } };
  }
}
