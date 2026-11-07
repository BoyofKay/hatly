import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProductChangeRequestsService, splitVendorProductPatch } from './product-change-requests.service';
import { ProductsService } from './products.service';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';
import { UploadsService } from '../uploads/uploads.service';
import { Product } from './entities/product.entity';
import { ProductCategory } from './entities/product-category.entity';
import { VendorUpdateProductDto } from './dto/vendor-update-product.dto';
import { VendorCreateProductDto } from './dto/vendor-create-product.dto';
import { ProductExcelImportService, ExcelImportValidationSummary, ExcelImportApplyResult } from './product-excel-import.service';

/**
 * CHUNK 12B-1 (Vendor Product Management). Every method here does the
 * SAME branch-ownership pattern used throughout Phase B
 * (VendorOrdersService): resolve the product's ACTUAL branch from the
 * database, then check ownership — never trust a client-supplied
 * branch id for authorization.
 *
 * CONFIRMED: zero business-rule duplication. Every write path calls
 * straight into `ProductsService`'s existing `admin*` methods —
 * `adminUpdateProduct` already enforces the exact Chunk 12A
 * OPEN/TRACKED transition rules, the immutable `pricingUnit`/
 * `vendorBranchId` exclusions, and the category-belongs-to-branch
 * check; none of that is reimplemented here. `AdminProductsService`
 * itself is untouched — this is a new, separate caller of
 * `ProductsService`, not a modification of the Admin path.
 *
 * `NotFoundException` (not `ForbiddenException`) is used for
 * unauthorized branch access — matches
 * `VendorStaffAuthorizationService`'s own documented convention
 * ("leaking 'this exists but isn't yours' is undesirable").
 */
@Injectable()
export class VendorProductsService {
  constructor(
    private readonly productsService: ProductsService,
    private readonly vendorStaffAuthorizationService: VendorStaffAuthorizationService,
    private readonly uploadsService: UploadsService,
    private readonly productExcelImportService: ProductExcelImportService,
    private readonly dataSource: DataSource,
    private readonly governance: ProductChangeRequestsService,
  ) {}

  /**
   * Excel Inventory & Price Management. The row-authorization callback
   * passed into `ProductExcelImportService` is exactly
   * `VendorStaffAuthorizationService.assertOwnsBranch`, converted to a
   * boolean — reused verbatim, never a second ownership check.
   */
  private branchAuthorizer(userId: string) {
    return async (vendorBranchId: string): Promise<boolean> => {
      try {
        await this.vendorStaffAuthorizationService.assertOwnsBranch(userId, vendorBranchId);
        return true;
      } catch {
        return false;
      }
    };
  }

  async getImportTemplate(userId: string, vendorBranchId: string): Promise<Buffer> {
    await this.vendorStaffAuthorizationService.assertOwnsBranch(userId, vendorBranchId);
    const products = await this.productsService.adminListProducts(vendorBranchId);
    return this.productExcelImportService.generateTemplate(products);
  }

  async getEmptyImportTemplate(userId: string, vendorBranchId: string): Promise<Buffer> {
    await this.vendorStaffAuthorizationService.assertOwnsBranch(userId, vendorBranchId);
    return this.productExcelImportService.generateTemplate([]);
  }

  async validateImport(userId: string, buffer: Buffer): Promise<ExcelImportValidationSummary> {
    const { summary } = await this.productExcelImportService.validate(buffer, this.branchAuthorizer(userId));
    return summary;
  }

  async applyImport(userId: string, buffer: Buffer): Promise<ExcelImportApplyResult> {
    return this.productExcelImportService.apply(buffer, this.branchAuthorizer(userId), { userId, role: 'VENDOR' });
  }

  private async assertOwnsProductBranch(userId: string, product: Product): Promise<void> {
    try {
      await this.vendorStaffAuthorizationService.assertOwnsBranch(userId, product.vendorBranchId);
    } catch {
      throw new NotFoundException('Product not found.');
    }
  }

  /**
   * `vendorBranchId` omitted → every branch the user owns. Loops the
   * existing single-branch `adminListProducts` call per owned branch —
   * a typical vendor has few branches, and this avoids adding a new
   * multi-branch query method to `ProductsService` for what is, at
   * this scale, a trivial concatenation.
   */
  /**
   * CHUNK 12B-2. `assertOwnsBranch` is called directly, unconverted —
   * unlike the read/update/activate/deactivate methods above, there is
   * no existing Product row yet whose existence could be leaked, so
   * this simply lets `VendorStaffAuthorizationService`'s own
   * `ForbiddenException` propagate rather than converting it to
   * `NotFoundException` (that conversion exists specifically to avoid
   * revealing "this Product exists but isn't yours," which doesn't
   * apply here).
   *
   * Delegates straight into the existing `ProductsService.adminCreateProduct`
   * — `assertBranchExists`, `assertCategoryBelongsToBranch`, and
   * `resolveInventoryFieldsForCreate` are all reused verbatim, exactly
   * as designed; nothing here reimplements any of Chunk 12A's
   * inventory rules or the category-branch check.
   */
  async createForUser(userId: string, dto: VendorCreateProductDto): Promise<Product> {
    await this.vendorStaffAuthorizationService.assertOwnsBranch(userId, dto.vendorBranchId);
    // R7: a vendor's new product waits for Hatly — saved PENDING and unavailable; it goes live (as the vendor asked) once approved.
    return this.dataSource.transaction(async (m) => {
      const product = await this.productsService.adminCreateProduct({ ...dto, isAvailable: false }, { approvalStatus: 'PENDING', manager: m });
      await this.governance.submitNew(m, product, { id: userId, role: 'VENDOR' }, 'DASHBOARD', dto.isAvailable !== false);
      return product;
    });
  }

  async listForUser(userId: string, vendorBranchId?: string): Promise<Product[]> {
    if (vendorBranchId) {
      try {
        await this.vendorStaffAuthorizationService.assertOwnsBranch(userId, vendorBranchId);
      } catch {
        // Same fail-closed shape as everywhere else — an unowned
        // branch id yields an empty list, not a 403 revealing that
        // the branch exists.
        return [];
      }
      return this.productsService.adminListProducts(vendorBranchId);
    }

    const ownedBranchIds = await this.vendorStaffAuthorizationService.getOwnedBranchIds(userId);
    if (ownedBranchIds.length === 0) {
      return [];
    }
    const perBranch = await Promise.all(
      ownedBranchIds.map((branchId) => this.productsService.adminListProducts(branchId)),
    );
    return perBranch.flat();
  }

  /**
   * CHUNK 12B-3. Read-only — no create/update/delete/activate/
   * deactivate capability exists on this surface at all (the absence
   * of those methods IS the read-only guarantee, not merely an
   * untested one). Mirrors `listForUser`'s exact ownership/aggregation
   * pattern above; reuses `ProductsService.adminListCategories`
   * verbatim — no category read logic is duplicated. Never touches
   * `AdminProductCategoriesController`/category mutation methods.
   */
  async listCategoriesForUser(userId: string, vendorBranchId?: string): Promise<ProductCategory[]> {
    if (vendorBranchId) {
      try {
        await this.vendorStaffAuthorizationService.assertOwnsBranch(userId, vendorBranchId);
      } catch {
        // Same fail-closed shape as listForUser — an unowned branch id
        // yields an empty list, never a 403 revealing that the branch
        // exists.
        return [];
      }
      return this.productsService.adminListCategories(vendorBranchId);
    }

    const ownedBranchIds = await this.vendorStaffAuthorizationService.getOwnedBranchIds(userId);
    if (ownedBranchIds.length === 0) {
      return [];
    }
    const perBranch = await Promise.all(
      ownedBranchIds.map((branchId) => this.productsService.adminListCategories(branchId)),
    );
    return perBranch.flat();
  }

  async getForUser(userId: string, productId: string): Promise<Product> {
    const product = await this.productsService.adminGetProduct(productId);
    await this.assertOwnsProductBranch(userId, product);
    return product;
  }

  /**
   * `dto` is `VendorUpdateProductDto` — a deliberately separate,
   * narrower class from Admin's `UpdateProductDto` (see that file's
   * own comment for why: `imageUrl` must be structurally absent, not
   * merely unused, for the global whitelist ValidationPipe to strip
   * it). Every field it DOES declare matches `UpdateProductDto`
   * exactly in name/type, so passing it straight through to
   * `adminUpdateProduct` is safe — `adminUpdateProduct` itself
   * performs the category-belongs-to-branch check and the Chunk 12A
   * inventory transition rules, reused verbatim.
   */
  /**
   * R7: on a product that is not live yet (PENDING / REJECTED) every change applies directly — Hatly reviews the product as a whole, and
   * editing a REJECTED product sends it back for review. On a live product a price reduction and inventory apply now; a price increase
   * and detail changes go to Hatly (`pendingChange`), and the approved version stays live meanwhile.
   */
  async updateForUser(userId: string, productId: string, dto: VendorUpdateProductDto): Promise<Product & { pendingChange: unknown }> {
    const product = await this.productsService.adminGetProduct(productId);
    await this.assertOwnsProductBranch(userId, product);
    const actor = { id: userId, role: 'VENDOR' };
    if (product.approvalStatus !== 'APPROVED') {
      return this.dataSource.transaction(async (m) => {
        const saved = await this.productsService.adminUpdateProduct(productId, dto, m, { userId, role: 'VENDOR' });
        if (product.approvalStatus === 'REJECTED') {
          await m.query(`UPDATE products SET approval_status = 'PENDING' WHERE id = $1`, [productId]);
          saved.approvalStatus = 'PENDING';
          await this.governance.submitNew(m, saved, actor, 'DASHBOARD', true);
        }
        return { ...saved, pendingChange: null };
      });
    }
    const { direct, gated } = splitVendorProductPatch(product, dto as Record<string, unknown>);
    let saved = product;
    let requestId: string | null = null;
    await this.dataSource.transaction(async (m) => {
      if (Object.keys(direct).length > 0) saved = await this.productsService.adminUpdateProduct(productId, direct as VendorUpdateProductDto, m, { userId, role: 'VENDOR' });
      if (Object.keys(gated).length > 0) requestId = await this.governance.submitUpdate(m, product, gated, actor, 'DASHBOARD');
    });
    return { ...saved, pendingChange: requestId ? await this.governance.view1(requestId) : null };
  }

  /** The vendor's own product reviews (new products, changes waiting for Hatly, decisions). */
  async listChangeRequestsForUser(userId: string, vendorBranchId?: string) {
    return this.governance.vendorList({ id: userId, role: 'VENDOR' }, vendorBranchId);
  }

  async withdrawChangeRequestForUser(userId: string, requestId: string) {
    return this.governance.withdraw({ id: userId, role: 'VENDOR' }, requestId);
  }

  async activateForUser(userId: string, productId: string): Promise<Product> {
    const product = await this.productsService.adminGetProduct(productId);
    await this.assertOwnsProductBranch(userId, product);
    // R7: a product Hatly has not approved cannot go live. While it waits, this records that the vendor wants it live once approved.
    if (product.approvalStatus === 'REJECTED') {
      throw new ConflictException({ message: 'Hatly rejected this product. Edit it to send it for review again.', details: { code: 'PRODUCT_REJECTED' } });
    }
    if (product.approvalStatus === 'PENDING') {
      await this.governance.setPendingAvailability(this.dataSource.manager, productId, true);
      return product;
    }
    return this.productsService.adminActivateProduct(productId);
  }

  async deactivateForUser(userId: string, productId: string): Promise<Product> {
    const product = await this.productsService.adminGetProduct(productId);
    await this.assertOwnsProductBranch(userId, product);
    if (product.approvalStatus === 'PENDING') await this.governance.setPendingAvailability(this.dataSource.manager, productId, false);
    return this.productsService.adminDeactivateProduct(productId);
  }

  /**
   * Tracked Inventory Order-Time Enforcement. Same ownership-then-
   * delegate pattern as every other method here — reuses
   * `ProductsService.adminSetInventoryToZero` verbatim (including its
   * OPEN-product rejection and its "only quantity" scope), zero
   * duplicated logic.
   */
  async setInventoryToZeroForUser(userId: string, productId: string): Promise<Product> {
    const product = await this.productsService.adminGetProduct(productId);
    await this.assertOwnsProductBranch(userId, product);
    return this.productsService.adminSetInventoryToZero(productId, { userId, role: 'VENDOR' });
  }

  /**
   * CHUNK 12B-1 CORRECTION. Ownership checked FIRST, before any
   * storage write — a cross-vendor attempt never reaches
   * `UploadsService`/the storage provider at all (verified by a
   * dedicated test asserting the upload mock is never called).
   *
   * Storage-then-DB-update ordering (per this chunk's explicit
   * replacement-safety requirement): the new file is written and
   * `UploadsService.upload()` has already returned successfully
   * BEFORE `Product.imageUrl` is touched — if storage throws, this
   * method throws too and the product's existing `imageUrl` is
   * completely untouched, never left pointing at a missing file.
   *
   * Old-file cleanup: deliberately NOT implemented here — per this
   * chunk's own instruction ("never delete the old image before the
   * new image is safely stored" + "do not add image deletion as a
   * separate endpoint unless necessary for safe replacement"), and
   * `UploadProvider` has no delete capability today; adding one
   * would be a real interface change affecting Cart's usage too,
   * which is out of this chunk's scope. Flagged as a genuine,
   * disclosed limitation, not silently done or silently skipped.
   */
  async uploadImageForUser(
    userId: string,
    productId: string,
    file: { buffer: Buffer; mimetype: string; size: number; originalname: string },
  ): Promise<Product> {
    const product = await this.productsService.adminGetProduct(productId);
    await this.assertOwnsProductBranch(userId, product);

    const allowedMimeTypes: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    };
    const extension = allowedMimeTypes[file.mimetype];
    if (!extension) {
      throw new BadRequestException({
        message: 'Only JPEG, PNG, or WebP images are allowed.',
        details: { code: 'UNSUPPORTED_IMAGE_TYPE' },
      });
    }

    const maxBytes = 5 * 1024 * 1024; // 5MB — documented default, no existing project convention found to match
    if (file.size > maxBytes) {
      throw new BadRequestException({
        message: 'Image exceeds the maximum allowed size of 5MB.',
        details: { code: 'IMAGE_TOO_LARGE' },
      });
    }

    // Filename passed to storage is derived from the VALIDATED MIME
    // type's extension, never the client's original filename —
    // matches LocalFilesystemUploadProvider's own safety contract.
    const safeFilename = `product-image${extension}`;
    const upload = await this.uploadsService.upload(file.buffer.toString('base64'), safeFilename, userId);

    // Storage succeeded — only now is the DB updated. R7: a new image of a LIVE product is a detail change Hatly approves first.
    if (product.approvalStatus === 'APPROVED') {
      const requestId = await this.governance.submitUpdate(this.dataSource.manager, product, { imageUrl: upload.url }, { id: userId, role: 'VENDOR' }, 'DASHBOARD');
      return { ...product, pendingChange: await this.governance.view1(requestId) } as Product;
    }
    return this.productsService.adminUpdateProduct(productId, { imageUrl: upload.url });
  }
}
