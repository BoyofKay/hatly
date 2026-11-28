import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CatalogProduct } from './entities/catalog-product.entity';
import { Product } from '../products/entities/product.entity';
import { CreateCatalogProductDto } from './dto/create-catalog-product.dto';
import { UpdateCatalogProductDto } from './dto/update-catalog-product.dto';
import { ListCatalogProductsQueryDto } from './dto/list-catalog-products-query.dto';
import { resolveLimit, resolvePage } from '../discovery/discovery.constants';

const PG_UNIQUE_VIOLATION = '23505';

export interface LinkedListingSummary {
  id: string;
  vendorBranchId: string;
  categoryId: string;
  name: string;
  nameAr: string | null;
  priceMinor: number;
  pricingUnit: string;
  isAvailable: boolean;
  catalogProductId: string | null;
}

/**
 * Admin-only management of the shared marketplace product identity and of the EXPLICIT link between a
 * catalog product and a vendor listing (an existing `products` row — its id never changes).
 *
 * Hard rules, all enforced here:
 *  - a link exists only because an admin created it — never inferred from names, never from a barcode;
 *  - a listing and its catalog product must share `pricing_unit`;
 *  - a catalog product appears at most once per vendor branch (also a partial unique index in the DB);
 *  - soft-deleted rows are invisible (TypeORM excludes them) and never block anything.
 */
@Injectable()
export class CatalogProductsService {
  constructor(
    @InjectRepository(CatalogProduct) private readonly catalogRepository: Repository<CatalogProduct>,
    @InjectRepository(Product) private readonly productsRepository: Repository<Product>,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------- catalog products

  async create(dto: CreateCatalogProductDto): Promise<CatalogProduct> {
    const barcode = dto.barcode?.trim() || null;
    if (barcode) await this.assertBarcodeFree(barcode);
    try {
      return await this.catalogRepository.save(
        this.catalogRepository.create({
          name: dto.name.trim(),
          nameAr: dto.nameAr ?? null,
          description: dto.description ?? null,
          descriptionAr: dto.descriptionAr ?? null,
          imageUrl: dto.imageUrl ?? null,
          brand: dto.brand ?? null,
          pricingUnit: dto.pricingUnit,
          barcode,
          isActive: dto.isActive ?? true,
        }),
      );
    } catch (error) {
      this.rethrowBarcodeConflict(error);
      throw error;
    }
  }

  async update(id: string, dto: UpdateCatalogProductDto): Promise<CatalogProduct> {
    const catalog = await this.getOrFail(id);

    if (dto.pricingUnit !== undefined && dto.pricingUnit !== catalog.pricingUnit) {
      const linked = await this.countLiveListings(this.dataSource.manager, id);
      if (linked > 0) {
        throw new ConflictException({
          message: 'The pricing unit cannot change while vendor listings are linked to this catalog product.',
          details: { code: 'PRICING_UNIT_LOCKED' },
        });
      }
      catalog.pricingUnit = dto.pricingUnit;
    }
    if (dto.barcode !== undefined) {
      const barcode = dto.barcode === null ? null : dto.barcode.trim() || null;
      if (barcode && barcode !== catalog.barcode) await this.assertBarcodeFree(barcode, id);
      catalog.barcode = barcode;
    }
    if (dto.name !== undefined) catalog.name = dto.name.trim();
    if (dto.nameAr !== undefined) catalog.nameAr = dto.nameAr;
    if (dto.description !== undefined) catalog.description = dto.description;
    if (dto.descriptionAr !== undefined) catalog.descriptionAr = dto.descriptionAr;
    if (dto.imageUrl !== undefined) catalog.imageUrl = dto.imageUrl;
    if (dto.brand !== undefined) catalog.brand = dto.brand;

    try {
      return await this.catalogRepository.save(catalog);
    } catch (error) {
      this.rethrowBarcodeConflict(error);
      throw error;
    }
  }

  async setActive(id: string, isActive: boolean): Promise<CatalogProduct> {
    const catalog = await this.getOrFail(id);
    catalog.isActive = isActive;
    return this.catalogRepository.save(catalog);
  }

  async getOrFail(id: string): Promise<CatalogProduct> {
    const catalog = await this.catalogRepository.findOne({ where: { id } });
    if (!catalog) throw new NotFoundException('Catalog product not found.');
    return catalog;
  }

  async getWithListings(id: string): Promise<{ catalogProduct: CatalogProduct; listings: LinkedListingSummary[] }> {
    const catalogProduct = await this.getOrFail(id);
    const products = await this.productsRepository
      .createQueryBuilder('product')
      .addSelect('product.catalogProductId')
      .where('product.catalog_product_id = :id', { id })
      .orderBy('product.created_at', 'ASC')
      .addOrderBy('product.id', 'ASC')
      .getMany();
    return { catalogProduct, listings: products.map((p) => this.toListingSummary(p)) };
  }

  async list(query: ListCatalogProductsQueryDto) {
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const qb = this.catalogRepository.createQueryBuilder('catalog');
    if (query.isActive !== undefined) qb.andWhere('catalog.is_active = :isActive', { isActive: query.isActive });
    if (query.barcode) qb.andWhere('catalog.barcode = :barcode', { barcode: query.barcode.trim() });
    if (query.search?.trim()) {
      qb.andWhere('(catalog.name_norm ILIKE hatly_norm(:term) OR catalog.name_ar_norm ILIKE hatly_norm(:term) OR catalog.brand ILIKE :term)', {
        term: `%${query.search.trim()}%`,
      });
    }
    const [data, total] = await qb
      .orderBy('catalog.created_at', 'DESC')
      .addOrderBy('catalog.id', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();
    return { data, page, limit, total };
  }

  // ---------------------------------------------------------------- explicit link / unlink

  /** Idempotent for the same pair; rejects everything else that would make the identity unsafe. */
  async linkListing(catalogProductId: string, productId: string): Promise<LinkedListingSummary> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const catalog = await manager.findOne(CatalogProduct, { where: { id: catalogProductId } });
        if (!catalog) throw new NotFoundException('Catalog product not found.');
        if (!catalog.isActive) {
          throw new ConflictException({
            message: 'An inactive catalog product cannot receive new listings. Activate it first.',
            details: { code: 'CATALOG_PRODUCT_INACTIVE' },
          });
        }

        const product = await this.loadListing(manager, productId);
        if (!product) throw new NotFoundException('Product not found.');

        if (product.catalogProductId === catalogProductId) return this.toListingSummary(product);
        if (product.catalogProductId) {
          throw new ConflictException({
            message: 'This listing is already linked to a different catalog product. Unlink it first.',
            details: { code: 'LISTING_ALREADY_LINKED' },
          });
        }
        if (product.pricingUnit !== catalog.pricingUnit) {
          throw new BadRequestException({
            message: `This listing is priced per ${product.pricingUnit} but the catalog product is priced per ${catalog.pricingUnit}.`,
            details: { code: 'PRICING_UNIT_MISMATCH' },
          });
        }
        const alreadyInBranch = await manager
          .createQueryBuilder(Product, 'product')
          .where('product.catalog_product_id = :catalogProductId', { catalogProductId })
          .andWhere('product.vendor_branch_id = :branchId', { branchId: product.vendorBranchId })
          .getCount();
        if (alreadyInBranch > 0) {
          throw this.branchDuplicate();
        }

        await manager.update(Product, { id: productId }, { catalogProductId });
        product.catalogProductId = catalogProductId;
        return this.toListingSummary(product);
      });
    } catch (error) {
      // The partial unique index is the real guarantee under concurrency.
      if ((error as { code?: string })?.code === PG_UNIQUE_VIOLATION) throw this.branchDuplicate();
      throw error;
    }
  }

  async unlinkListing(catalogProductId: string, productId: string): Promise<LinkedListingSummary> {
    return this.dataSource.transaction(async (manager) => {
      await this.getOrFailWith(manager, catalogProductId);
      const product = await this.loadListing(manager, productId);
      if (!product) throw new NotFoundException('Product not found.');
      if (product.catalogProductId !== catalogProductId) {
        throw new NotFoundException({
          message: 'This listing is not linked to this catalog product.',
          details: { code: 'LISTING_NOT_LINKED' },
        });
      }
      await manager.update(Product, { id: productId }, { catalogProductId: null });
      product.catalogProductId = null;
      return this.toListingSummary(product);
    });
  }

  // ---------------------------------------------------------------- helpers

  private async getOrFailWith(manager: EntityManager, id: string): Promise<CatalogProduct> {
    const catalog = await manager.findOne(CatalogProduct, { where: { id } });
    if (!catalog) throw new NotFoundException('Catalog product not found.');
    return catalog;
  }

  private loadListing(manager: EntityManager, productId: string): Promise<Product | null> {
    return manager
      .createQueryBuilder(Product, 'product')
      .addSelect('product.catalogProductId')
      .where('product.id = :productId', { productId })
      .getOne();
  }

  private countLiveListings(manager: EntityManager, catalogProductId: string): Promise<number> {
    return manager
      .createQueryBuilder(Product, 'product')
      .where('product.catalog_product_id = :catalogProductId', { catalogProductId })
      .getCount();
  }

  private async assertBarcodeFree(barcode: string, exceptId?: string): Promise<void> {
    const existing = await this.catalogRepository.findOne({ where: { barcode } });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException({
        message: 'A catalog product with this barcode already exists.',
        details: { code: 'CATALOG_BARCODE_ALREADY_EXISTS', catalogProductId: existing.id },
      });
    }
  }

  private rethrowBarcodeConflict(error: unknown): void {
    if ((error as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
      throw new ConflictException({
        message: 'A catalog product with this barcode already exists.',
        details: { code: 'CATALOG_BARCODE_ALREADY_EXISTS' },
      });
    }
  }

  private branchDuplicate(): ConflictException {
    return new ConflictException({
      message: 'This vendor branch already lists this catalog product.',
      details: { code: 'CATALOG_PRODUCT_ALREADY_LISTED_IN_BRANCH' },
    });
  }

  private toListingSummary(product: Product): LinkedListingSummary {
    return {
      id: product.id,
      vendorBranchId: product.vendorBranchId,
      categoryId: product.categoryId,
      name: product.name,
      nameAr: product.nameAr ?? null,
      priceMinor: product.priceMinor,
      pricingUnit: product.pricingUnit,
      isAvailable: product.isAvailable,
      catalogProductId: product.catalogProductId ?? null,
    };
  }
}
