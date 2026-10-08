import { DataSource, EntityManager } from 'typeorm';
import { AppDataSource } from '../database/data-source';
import { User } from '../modules/users/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { Address } from '../modules/addresses/entities/address.entity';
import { ServiceArea } from '../modules/service-areas/entities/service-area.entity';
import { MarketplaceSector } from '../modules/sectors/entities/marketplace-sector.entity';
import { MarketplaceSubcategory } from '../modules/sectors/entities/marketplace-subcategory.entity';
import { VendorBranchSubcategory } from '../modules/sectors/entities/vendor-branch-subcategory.entity';
import { Vendor } from '../modules/vendors/entities/vendor.entity';
import { VendorBranch } from '../modules/vendors/entities/vendor-branch.entity';
import { ProductCategory } from '../modules/products/entities/product-category.entity';
import { Product } from '../modules/products/entities/product.entity';
import { ProductOption } from '../modules/products/entities/product-option.entity';
import { ProductOptionValue } from '../modules/products/entities/product-option-value.entity';
import { PricingUnit } from '../modules/products/pricing-unit.enum';
import { InventoryMode } from '../modules/products/inventory-mode.enum';
import { CatalogProduct } from '../modules/catalog/entities/catalog-product.entity';
import { Offer } from '../modules/offers/entities/offer.entity';
import { OfferProduct } from '../modules/offers/entities/offer-product.entity';
import { OfferMechanism } from '../modules/offers/offer-mechanism.enum';
import { DiscountType } from '../modules/offers/discount-type.enum';
import { BusinessConfig } from '../modules/business-config/entities/business-config.entity';
import { BusinessConfigKey } from '../modules/business-config/business-config-key.enum';
import { collectMediaTargets } from './marketplace-media-inventory';
import { DEFAULT_MEDIA_DIR, isSeededMediaUrl, localUploadExists, stageMediaFile } from './seed-media';
import { existsSync } from 'fs';
import * as bcrypt from 'bcrypt';
import { Driver } from '../modules/delivery/entities/driver.entity';
import { VendorStaff } from '../modules/vendors/entities/vendor-staff.entity';
import { AdminPermission } from '../modules/permissions/entities/admin-permission.entity';
import { Permission } from '../modules/permissions/permission.enum';
import { DeliveryZone } from '../modules/delivery-zones/entities/delivery-zone.entity';
import { DEFAULT_BELBEIS_ZONES } from './delivery-zones-seed';

/**
 * DEVELOPMENT-ONLY MARKETPLACE SEED.
 *
 * Populates `hatly_dev` with a small, realistic, self-consistent Marketplace so the customer app's real
 * Explore → vendor → product → cart → checkout → order flow can be exercised end to end WITHOUT the
 * debug-only demo/mock fallback (`home_demo_content.dart`) ever needing to fill in.
 *
 * Run via: `npm run seed:dev-marketplace`
 *
 * NOT an HTTP endpoint and NOT imported by `app.module.ts` or any controller — same convention as
 * `bootstrap-admin.ts`: a standalone Node process against the same `AppDataSource` the TypeORM CLI uses.
 *
 * SAFETY: refuses to run against anything but a database literally named `hatly_dev` (checked from the
 * live connection itself, not just the `.env` file) — see `assertDevDatabase()`. Nothing here ever touches
 * production configuration, data, or schema; every write goes through the SAME entities/constraints/FKs
 * the real application uses — no raw SQL, no bypassed validation.
 *
 * IDEMPOTENCY: every row is found-by-natural-key before being created (vendor by name, branch by
 * (vendorId, name), sector by slug, product by (vendorBranchId, name), offer by (vendorBranchId, name),
 * service area by name, business-config by key). Re-running this script updates nothing that already
 * exists and creates nothing twice — see `findOrCreate()`.
 */

const DEV_CUSTOMER_PHONE = '+201000863694';

// Belbeis, Sharqia — a clearly-fixture development location, not the operator's real location.
const BELBEIS_CENTER = { latitude: 30.4181, longitude: 31.5622 };
const SERVICE_AREA_RADIUS_METERS = 15000;

async function assertDevDatabase(dataSource: DataSource): Promise<void> {
  const rows: Array<{ current_database: string }> = await dataSource.query('SELECT current_database()');
  const name = rows[0]?.current_database;
  if (name !== 'hatly_dev') {
    throw new Error(
      `Refusing to seed: connected database is "${name}", not "hatly_dev". ` +
        'This script must only ever run against the development database.',
    );
  }
  console.log(`Connected database verified: "${name}" (development only).`);
}

async function findOrCreate<T extends { id: string }>(
  manager: EntityManager,
  entity: { new (): T },
  where: Partial<T>,
  build: () => Partial<T>,
): Promise<{ row: T; created: boolean }> {
  const repo = manager.getRepository(entity);
  const existing = await repo.findOne({ where: where as any });
  if (existing) return { row: existing, created: false };
  const row = repo.create(build() as any) as unknown as T;
  const saved = await repo.save(row);
  return { row: saved, created: true };
}

/**
 * Consolidated customer-commerce milestone (Part E — Sector
 * Subcategories): `VendorBranchSubcategory` has no surrogate `id`
 * (composite primary key on the pair itself — see the entity's own
 * doc comment), so it can't use the generic `findOrCreate<T extends
 * {id: string}>` above. Same idempotency discipline regardless:
 * checked before inserted, re-running this script assigns nothing
 * twice.
 */
async function ensureBranchSubcategory(
  manager: EntityManager,
  vendorBranchId: string,
  subcategoryId: string,
): Promise<boolean> {
  const repo = manager.getRepository(VendorBranchSubcategory);
  const existing = await repo.findOne({ where: { vendorBranchId, subcategoryId } });
  if (existing) return false;
  await repo.insert({ vendorBranchId, subcategoryId });
  return true;
}

async function upsertBusinessConfig(
  manager: EntityManager,
  key: BusinessConfigKey,
  value: unknown,
  description: string,
): Promise<void> {
  const repo = manager.getRepository(BusinessConfig);
  const existing = await repo.findOne({ where: { key } });
  if (existing) {
    console.log(`  business_config ${key} already set (value=${JSON.stringify(existing.value)}) — left unchanged.`);
    return;
  }
  await repo.save(repo.create({ key, value, description }));
  console.log(`  business_config ${key} = ${JSON.stringify(value)} (created).`);
}

/**
 * Tester/demo determinism for the two OPERATIONAL switches (not money values): a reseed puts them back to the defaults
 * their own migrations seed (`true`), whatever a previous manual or automated toggle left behind — e.g. the
 * MULTI_VENDOR_ORDERS_ENABLED=false that made the Customer App answer "الطلب من أكثر من متجر غير متاح حاليًا".
 * A value that already matches is left untouched.
 */
async function restoreOperationalSwitch(manager: EntityManager, key: BusinessConfigKey, value: boolean): Promise<void> {
  const repo = manager.getRepository(BusinessConfig);
  const existing = await repo.findOne({ where: { key } });
  if (!existing) {
    await repo.save(repo.create({ key, value, description: 'Dev/tester seed: operational switch at its migration default.' }));
    console.log(`  business_config ${key} = ${value} (created).`);
  } else if (existing.value !== value) {
    await repo.update({ id: existing.id }, { value });
    console.log(`  business_config ${key}: ${JSON.stringify(existing.value)} → ${value} (restored to the tester default).`);
  } else {
    console.log(`  business_config ${key} = ${value} (already at the tester default).`);
  }
}

interface SeedSummary {
  sectors: number;
  subcategories: number;
  vendors: number;
  branches: number;
  branchSubcategoryAssignments: number;
  categories: number;
  products: number;
  options: number;
  optionValues: number;
  catalogProducts: number;
  offers: number;
  mediaApplied: number;
  mediaRestaged: number;
  mediaCleared: number;
  mediaMissing: number;
  brokenImageReferences: number;
}

async function seed(manager: EntityManager): Promise<SeedSummary> {
  const summary: SeedSummary = {
    sectors: 0,
    subcategories: 0,
    vendors: 0,
    branches: 0,
    branchSubcategoryAssignments: 0,
    categories: 0,
    products: 0,
    options: 0,
    optionValues: 0,
    catalogProducts: 0,
    offers: 0,
    mediaApplied: 0,
    mediaRestaged: 0,
    mediaCleared: 0,
    mediaMissing: 0,
    brokenImageReferences: 0,
  };

  // ---------------------------------------------------------------------
  // 0. Development-only checkout configuration these flows genuinely need
  //    (REGISTERED_VENDOR_* are `getRequired` in DeliveryFeeCalculationService
  //    — without them, EVERY delivery checkout quote fails closed with
  //    `DELIVERY_FEE_UNAVAILABLE`, regardless of vendor data). Same values
  //    the project's own e2e test fixtures already use
  //    (`Scenario.configureDeliveryPricing`'s defaults) — nothing invented.
  // ---------------------------------------------------------------------
  console.log('Step 0: business configuration (money values: only fills keys nobody has set yet)');
  await restoreOperationalSwitch(manager, BusinessConfigKey.MULTI_VENDOR_ORDERS_ENABLED, true);
  await restoreOperationalSwitch(manager, BusinessConfigKey.AUTOMATIC_DISPATCH_ENABLED, true);
  await upsertBusinessConfig(
    manager,
    BusinessConfigKey.REGISTERED_VENDOR_PRICE_PER_100M_MINOR,
    1000,
    'Dev seed: 10 EGP / 100m, matching the project\'s own e2e fixture default.',
  );
  await upsertBusinessConfig(
    manager,
    BusinessConfigKey.REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR,
    1500,
    'Dev seed: 15 EGP minimum delivery fee, matching the project\'s own e2e fixture default.',
  );
  await upsertBusinessConfig(
    manager,
    BusinessConfigKey.REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR,
    500,
    'Dev seed: 5 EGP per extra vendor, matching the project\'s own e2e fixture default.',
  );

  // ---------------------------------------------------------------------
  // 1. Service area — Belbeis (Sharqia). Every seeded branch AND the dev
  //    customer's address live inside this same area/radius, so serviceability
  //    (AddressValidationService.checkEligibility) resolves cleanly.
  // ---------------------------------------------------------------------
  console.log('Step 1: service area');
  const { row: serviceArea, created: serviceAreaCreated } = await findOrCreate(
    manager,
    ServiceArea,
    { name: 'Belbeis' },
    () => ({
      name: 'Belbeis',
      nameAr: 'بلبيس',
      centerLatitude: BELBEIS_CENTER.latitude,
      centerLongitude: BELBEIS_CENTER.longitude,
      radiusMeters: SERVICE_AREA_RADIUS_METERS,
      isActive: true,
    }),
  );
  console.log(`  ServiceArea "Belbeis" ${serviceAreaCreated ? 'created' : 'already existed'} (${serviceArea.id}).`);

  // ---------------------------------------------------------------------
  // 2. Marketplace sectors (Level 1 taxonomy — Admin-managed, dynamic).
  // ---------------------------------------------------------------------
  console.log('Step 2: marketplace sectors');
  const sectorDefs = [
    { slug: 'restaurants', name: 'Restaurants', nameAr: 'مطاعم', sortOrder: 0 },
    { slug: 'groceries', name: 'Groceries', nameAr: 'بقالة', sortOrder: 1 },
    { slug: 'pharmacy', name: 'Pharmacy', nameAr: 'صيدليات', sortOrder: 2 },
    { slug: 'bakery', name: 'Bakery', nameAr: 'مخبوزات', sortOrder: 3 },
    // DEV MARKETPLACE EXPANSION (pre-demo dataset) — three additional sectors, same existing
    // MarketplaceSector model/conventions, no schema change.
    { slug: 'meat-poultry', name: 'Meat & Poultry', nameAr: 'لحوم ودواجن', sortOrder: 4 },
    { slug: 'produce', name: 'Fruits & Vegetables', nameAr: 'خضار وفاكهة', sortOrder: 5 },
    { slug: 'household', name: 'Household', nameAr: 'أدوات منزلية', sortOrder: 6 },
  ];
  const sectors: Record<string, MarketplaceSector> = {};
  for (const def of sectorDefs) {
    const { row, created } = await findOrCreate(manager, MarketplaceSector, { slug: def.slug }, () => ({
      name: def.name,
      nameAr: def.nameAr,
      slug: def.slug,
      sortOrder: def.sortOrder,
      isActive: true,
    }));
    sectors[def.slug] = row;
    if (created) summary.sectors++;
    console.log(`  Sector "${def.slug}" ${created ? 'created' : 'already existed'} (${row.id}).`);
  }

  // ---------------------------------------------------------------------
  // 2b. Sector subcategories (consolidated customer-commerce milestone,
  //     Part E — Level 1.5 taxonomy WITHIN an existing sector; a real
  //     backend model, never hardcoded in Flutter). `imageUrl` is left
  //     null everywhere — see Part F's own audit note in the final
  //     report for the exact list of real image files this milestone
  //     still needs generated; no fake/placeholder URL is committed here.
  // ---------------------------------------------------------------------
  console.log('Step 2b: sector subcategories');
  const subcategoryDefs = [
    { sectorSlug: 'restaurants', name: 'Fast Food', nameAr: 'وجبات سريعة', sortOrder: 0 },
    { sectorSlug: 'restaurants', name: 'Oriental', nameAr: 'مأكولات شرقية', sortOrder: 1 },
    { sectorSlug: 'restaurants', name: 'Cafes & Desserts', nameAr: 'كافيهات وحلويات', sortOrder: 2 },
    { sectorSlug: 'groceries', name: 'Fresh Produce', nameAr: 'خضار وفاكهة طازجة', sortOrder: 0 },
    { sectorSlug: 'groceries', name: 'Dairy & Eggs', nameAr: 'ألبان وبيض', sortOrder: 1 },
    { sectorSlug: 'groceries', name: 'Beverages', nameAr: 'مشروبات', sortOrder: 2 },
    { sectorSlug: 'groceries', name: 'Snacks & Sweets', nameAr: 'سناكس وحلويات', sortOrder: 3 },
    { sectorSlug: 'pharmacy', name: 'Medicines & OTC', nameAr: 'أدوية بدون روشتة', sortOrder: 0 },
    { sectorSlug: 'pharmacy', name: 'Personal Care', nameAr: 'العناية الشخصية', sortOrder: 1 },
    { sectorSlug: 'pharmacy', name: 'Baby Care', nameAr: 'عناية الطفل', sortOrder: 2 },
    { sectorSlug: 'pharmacy', name: 'Vitamins & Supplements', nameAr: 'فيتامينات ومكملات', sortOrder: 3 },
    { sectorSlug: 'produce', name: 'Fresh Fruits', nameAr: 'فاكهة طازجة', sortOrder: 0 },
    { sectorSlug: 'produce', name: 'Fresh Vegetables', nameAr: 'خضار طازجة', sortOrder: 1 },
    { sectorSlug: 'produce', name: 'Herbs & Leafy Greens', nameAr: 'أعشاب وورقيات', sortOrder: 2 },
  ] as const;
  const subcategories: Record<string, MarketplaceSubcategory> = {};
  for (const def of subcategoryDefs) {
    const sector = sectors[def.sectorSlug];
    const { row, created } = await findOrCreate(
      manager,
      MarketplaceSubcategory,
      { sectorId: sector.id, name: def.name },
      () => ({
        sectorId: sector.id,
        name: def.name,
        nameAr: def.nameAr,
        sortOrder: def.sortOrder,
        isActive: true,
      }),
    );
    subcategories[`${def.sectorSlug}:${def.name}`] = row;
    if (created) summary.subcategories++;
    console.log(`  Subcategory "${def.name}" (${def.sectorSlug}) ${created ? 'created' : 'already existed'} (${row.id}).`);
  }

  // ---------------------------------------------------------------------
  // 3. Development customer — reuse the existing one; give it a default
  //    address inside the same service area if it doesn't have one yet.
  // ---------------------------------------------------------------------
  console.log('Step 3: development customer address');
  const usersRepo = manager.getRepository(User);
  const devCustomer = await usersRepo.findOne({ where: { phone: DEV_CUSTOMER_PHONE, role: Role.CUSTOMER } });
  if (!devCustomer) {
    throw new Error(
      `No CUSTOMER found with phone ${DEV_CUSTOMER_PHONE}. Run this only after the existing dev customer/auth setup ` +
        'already created it (see the dev auth diagnosis/setup done earlier) — this script never creates a new user.',
    );
  }
  const addressesRepo = manager.getRepository(Address);
  const existingDefaultAddress = await addressesRepo.findOne({
    where: { customerId: devCustomer.id, isDefault: true, isActive: true },
  });
  if (existingDefaultAddress) {
    console.log(`  Dev customer already has a default address (${existingDefaultAddress.id}) — left unchanged.`);
  } else {
    const address = addressesRepo.create({
      customerId: devCustomer.id,
      label: 'المنزل',
      line1: 'شارع الجمهورية، بلبيس، الشرقية',
      latitude: BELBEIS_CENTER.latitude,
      longitude: BELBEIS_CENTER.longitude,
      governorate: 'الشرقية',
      city: 'بلبيس',
      street: 'شارع الجمهورية',
      isDefault: true,
      isActive: true,
    });
    const saved = await addressesRepo.save(address);
    console.log(`  Created dev customer default address (${saved.id}) inside the Belbeis service area.`);
  }

  // ---------------------------------------------------------------------
  // 4. Vendors, branches, categories, products, options.
  // ---------------------------------------------------------------------
  console.log('Step 4: vendors, branches, catalog');

  const vendorsRepo = manager.getRepository(Vendor);
  const branchesRepo = manager.getRepository(VendorBranch);
  const categoriesRepo = manager.getRepository(ProductCategory);
  const productsRepo = manager.getRepository(Product);
  const optionsRepo = manager.getRepository(ProductOption);
  const optionValuesRepo = manager.getRepository(ProductOptionValue);

  /**
   * `formerNames`: names this demo vendor was seeded under before. A vendor still carrying one is RENAMED in place (same
   * id, branches, products, orders, staff, logo) — never recreated next to it — so a rename can never duplicate a vendor.
   */
  async function ensureVendor(name: string, nameAr: string, formerNames: string[] = []): Promise<{ vendor: Vendor; created: boolean }> {
    for (const formerName of formerNames) {
      const former = await manager.findOne(Vendor, { where: { name: formerName } });
      if (former && !(await manager.findOne(Vendor, { where: { name } }))) {
        await manager.update(Vendor, former.id, { name, nameAr });
        console.log(`  Vendor "${formerName}" renamed to "${name}" / "${nameAr}" (${former.id}).`);
      }
    }
    const { row, created } = await findOrCreate(manager, Vendor, { name }, () => ({
      name,
      nameAr,
      isActive: true,
    }));
    if (created) summary.vendors++;
    console.log(`  Vendor "${name}" ${created ? 'created' : 'already existed'} (${row.id}).`);
    return { vendor: row, created };
  }

  async function ensureBranch(
    vendor: Vendor,
    def: {
      name: string;
      address: string;
      latitude: number;
      longitude: number;
      sector: MarketplaceSector;
      deliveryEnabled: boolean;
      pickupEnabled: boolean;
      isOpen: boolean;
      commissionRateBasisPoints: number;
      preparationTimeMinutes: number;
      openingHours: Record<string, { open: string; close: string }>;
      ratingCount?: number;
      ratingSumStars?: number;
    },
  ): Promise<VendorBranch> {
    const { row, created } = await findOrCreate(manager, VendorBranch, { vendorId: vendor.id, name: def.name }, () => ({
      vendorId: vendor.id,
      name: def.name,
      address: def.address,
      latitude: def.latitude,
      longitude: def.longitude,
      serviceAreaId: serviceArea.id,
      marketplaceSectorId: def.sector.id,
      openingHours: def.openingHours,
      isOpen: def.isOpen,
      isActive: true,
      deliveryEnabled: def.deliveryEnabled,
      pickupEnabled: def.pickupEnabled,
      commissionRateBasisPoints: def.commissionRateBasisPoints,
      preparationTimeMinutes: def.preparationTimeMinutes,
      ratingCount: def.ratingCount ?? 0,
      ratingSumStars: def.ratingSumStars ?? 0,
    }));
    if (created) summary.branches++;
    console.log(`    Branch "${def.name}" ${created ? 'created' : 'already existed'} (${row.id}).`);
    return row;
  }

  async function ensureCategory(branch: VendorBranch, name: string, nameAr: string, sortOrder: number): Promise<ProductCategory> {
    const { row, created } = await findOrCreate(manager, ProductCategory, { vendorBranchId: branch.id, name }, () => ({
      vendorBranchId: branch.id,
      name,
      nameAr,
      sortOrder,
      isActive: true,
    }));
    if (created) summary.categories++;
    return row;
  }

  async function ensureProduct(
    branch: VendorBranch,
    category: ProductCategory,
    def: {
      name: string;
      nameAr: string;
      priceMinor: number;
      pricingUnit?: PricingUnit;
      inventoryMode?: InventoryMode;
      quantity?: number | null;
      ratingCount?: number;
      ratingSumStars?: number;
    },
  ): Promise<Product> {
    const { row, created } = await findOrCreate(manager, Product, { vendorBranchId: branch.id, name: def.name }, () => ({
      vendorBranchId: branch.id,
      categoryId: category.id,
      name: def.name,
      nameAr: def.nameAr,
      priceMinor: def.priceMinor,
      pricingUnit: def.pricingUnit ?? PricingUnit.PIECE,
      isAvailable: true,
      inventoryMode: def.inventoryMode ?? InventoryMode.OPEN,
      quantity: def.quantity ?? null,
      ratingCount: def.ratingCount ?? 0,
      ratingSumStars: def.ratingSumStars ?? 0,
    }));
    if (created) summary.products++;
    return row;
  }

  async function ensureOption(
    product: Product,
    name: string,
    nameAr: string,
    isRequired: boolean,
    allowsMultiple: boolean,
    values: Array<{ name: string; nameAr: string; priceDeltaMinor: number }>,
  ): Promise<void> {
    const { row: option, created } = await findOrCreate(manager, ProductOption, { productId: product.id, name }, () => ({
      productId: product.id,
      name,
      nameAr,
      isRequired,
      allowsMultiple,
    }));
    if (created) summary.options++;
    for (const v of values) {
      const { created: valueCreated } = await findOrCreate(manager, ProductOptionValue, { optionId: option.id, name: v.name }, () => ({
        optionId: option.id,
        name: v.name,
        nameAr: v.nameAr,
        priceDeltaMinor: v.priceDeltaMinor,
      }));
      if (valueCreated) summary.optionValues++;
    }
  }

  const dailyHoursStandard: Record<string, { open: string; close: string }> = {
    sat: { open: '09:00', close: '23:00' },
    sun: { open: '09:00', close: '23:00' },
    mon: { open: '09:00', close: '23:00' },
    tue: { open: '09:00', close: '23:00' },
    wed: { open: '09:00', close: '23:00' },
    thu: { open: '09:00', close: '23:30' },
    fri: { open: '14:00', close: '23:00' },
  };

  // --- Vendor 1: restaurant (single branch, pickup+delivery, highest-rated fixture) ---
  const { vendor: restaurantVendor } = await ensureVendor('Beit El Sharkia Restaurant', 'مطعم بيت الشرقية');
  const restaurantBranch = await ensureBranch(restaurantVendor, {
    name: 'الفرع الرئيسي',
    address: 'شارع مصطفى كامل، بلبيس، الشرقية',
    latitude: 30.4205,
    longitude: 31.565,
    sector: sectors.restaurants,
    deliveryEnabled: true,
    pickupEnabled: true,
    isOpen: true,
    commissionRateBasisPoints: 1000,
    preparationTimeMinutes: 30,
    openingHours: dailyHoursStandard,
    ratingCount: 128,
    ratingSumStars: 589, // avg ≈ 4.60 — above HIGHEST_RATED_MINIMUM_RATING_COUNT (5)
  });
  const grillsCategory = await ensureCategory(restaurantBranch, 'مشويات', 'مشويات', 0);
  const startersCategory = await ensureCategory(restaurantBranch, 'مقبلات', 'مقبلات', 1);
  const drinksCategory = await ensureCategory(restaurantBranch, 'مشروبات', 'مشروبات', 2);

  const grilledChicken = await ensureProduct(restaurantBranch, grillsCategory, {
    name: 'Grilled Chicken',
    nameAr: 'فراخ مشوية',
    priceMinor: 9000,
    ratingCount: 42,
    ratingSumStars: 189, // avg ≈ 4.5
  });
  await ensureOption(grilledChicken, 'Size', 'الحجم', true, false, [
    { name: 'Half chicken', nameAr: 'نص فرخة', priceDeltaMinor: 0 },
    { name: 'Whole chicken', nameAr: 'فرخة كاملة', priceDeltaMinor: 9000 },
    { name: 'Two whole chickens', nameAr: 'فرختين', priceDeltaMinor: 18000 },
  ]);
  await ensureProduct(restaurantBranch, grillsCategory, { name: 'Mixed Grill', nameAr: 'مشاوي مشكلة', priceMinor: 15000 });
  await ensureProduct(restaurantBranch, startersCategory, { name: 'Rice with Vermicelli', nameAr: 'أرز بالشعرية', priceMinor: 2000 });
  await ensureProduct(restaurantBranch, startersCategory, { name: 'Green Salad', nameAr: 'سلطة خضراء', priceMinor: 1500 });
  await ensureProduct(restaurantBranch, drinksCategory, { name: 'Soft Drink Can', nameAr: 'مشروب غازي', priceMinor: 1000 });

  // Branch-wide SUBTOTAL_DISCOUNT — no product/category targeting (valid per CreateOfferDto's own contract).
  {
    const { row: offer, created } = await findOrCreate(
      manager,
      Offer,
      { vendorBranchId: restaurantBranch.id, name: 'خصم بيت الشرقية' },
      () => ({
        vendorBranchId: restaurantBranch.id,
        name: 'خصم بيت الشرقية',
        mechanism: OfferMechanism.SUBTOTAL_DISCOUNT,
        discountType: DiscountType.PERCENTAGE,
        discountValue: 1000, // 10.00% (basis points)
        minimumEligibleSubtotalMinor: 5000,
        maximumDiscountMinor: 3000,
        startAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isActive: true,
      }),
    );
    if (created) summary.offers++;
    console.log(`    Offer "${offer.name}" ${created ? 'created' : 'already existed'} (branch-wide 10% off).`);
  }

  // --- Vendor 2: supermarket (two branches — main serviceable+pickup, second delivery-only & closed) ---
  const { vendor: marketVendor } = await ensureVendor('Belbeis Supermarket', 'سوبر ماركت بلبيس');
  const marketMain = await ensureBranch(marketVendor, {
    name: 'الفرع الرئيسي',
    address: 'ميدان بلبيس، الشرقية',
    latitude: 30.4165,
    longitude: 31.56,
    sector: sectors.groceries,
    deliveryEnabled: true,
    pickupEnabled: true,
    isOpen: true,
    commissionRateBasisPoints: 800,
    preparationTimeMinutes: 20,
    openingHours: dailyHoursStandard,
  });
  const marketStation = await ensureBranch(marketVendor, {
    name: 'فرع المحطة',
    address: 'شارع المحطة، بلبيس، الشرقية',
    latitude: 30.423,
    longitude: 31.558,
    sector: sectors.groceries,
    deliveryEnabled: true,
    pickupEnabled: false,
    isOpen: false, // realistic diversity: this branch is currently closed
    commissionRateBasisPoints: 800,
    preparationTimeMinutes: 25,
    openingHours: dailyHoursStandard,
  });

  const produceMain = await ensureCategory(marketMain, 'خضار وفاكهة', 'خضار وفاكهة', 0);
  const dairyMain = await ensureCategory(marketMain, 'ألبان ومعلبات', 'ألبان ومعلبات', 1);
  const produceStation = await ensureCategory(marketStation, 'خضار وفاكهة', 'خضار وفاكهة', 0);
  const dairyStation = await ensureCategory(marketStation, 'ألبان ومعلبات', 'ألبان ومعلبات', 1);

  await ensureProduct(marketMain, dairyMain, {
    name: 'Rice 1kg',
    nameAr: 'أرز أبو كاس 1 كيلو',
    priceMinor: 4500,
    inventoryMode: InventoryMode.TRACKED,
    quantity: 200,
  });
  const sunflowerOilMain = await ensureProduct(marketMain, dairyMain, {
    name: 'Sunflower Oil 1L',
    nameAr: 'زيت عباد الشمس 1 لتر',
    priceMinor: 6000,
    inventoryMode: InventoryMode.TRACKED,
    quantity: 150,
  });
  await ensureProduct(marketMain, produceMain, {
    name: 'Tomatoes',
    nameAr: 'طماطم',
    priceMinor: 2500, // per kg
    pricingUnit: PricingUnit.WEIGHT,
  });
  await ensureProduct(marketMain, dairyMain, {
    name: 'Juhayna Milk 1L',
    nameAr: 'لبن جهينة 1 لتر',
    priceMinor: 3200,
    inventoryMode: InventoryMode.TRACKED,
    quantity: 100,
  });
  const baladiEggs = await ensureProduct(marketMain, dairyMain, {
    name: 'Baladi Eggs (30)',
    nameAr: 'بيض بلدي (30 بيضة)',
    priceMinor: 9000,
    inventoryMode: InventoryMode.TRACKED,
    quantity: 80,
  });

  const sunflowerOilStation = await ensureProduct(marketStation, dairyStation, {
    name: 'Sunflower Oil 1L',
    nameAr: 'زيت عباد الشمس 1 لتر',
    priceMinor: 6200,
    inventoryMode: InventoryMode.TRACKED,
    quantity: 60,
  });
  await ensureProduct(marketStation, produceStation, {
    name: 'Cucumbers',
    nameAr: 'خيار',
    priceMinor: 1800, // per kg
    pricingUnit: PricingUnit.WEIGHT,
  });
  await ensureProduct(marketStation, dairyStation, { name: 'Local Cheese 500g', nameAr: 'جبنة بيضة 500 جرام', priceMinor: 5000 });

  // Shared marketplace product identity — same real product sold by two branches at two different prices.
  {
    const catalogRepo = manager.getRepository(CatalogProduct);
    const { row: catalogProduct, created } = await findOrCreate(
      manager,
      CatalogProduct,
      { name: 'Sunflower Oil 1L' },
      () => ({
        name: 'Sunflower Oil 1L',
        nameAr: 'زيت عباد الشمس 1 لتر',
        brand: 'مطاحن مصر',
        pricingUnit: PricingUnit.PIECE,
        isActive: true,
      }),
    );
    if (created) summary.catalogProducts++;
    console.log(`    CatalogProduct "${catalogProduct.name}" ${created ? 'created' : 'already existed'} (${catalogProduct.id}).`);
    for (const listing of [sunflowerOilMain, sunflowerOilStation]) {
      if (listing.pricingUnit !== catalogProduct.pricingUnit) continue; // matches AdminCatalogProductsService's own invariant
      if (listing.catalogProductId === catalogProduct.id) continue;
      await productsRepo.update({ id: listing.id }, { catalogProductId: catalogProduct.id });
    }
  }

  // FLASH_SALE targeting one specific product (offer_products join row).
  {
    const { row: offer, created } = await findOrCreate(
      manager,
      Offer,
      { vendorBranchId: marketMain.id, name: 'تخفيض البيض البلدي' },
      () => ({
        vendorBranchId: marketMain.id,
        name: 'تخفيض البيض البلدي',
        mechanism: OfferMechanism.FLASH_SALE,
        specialPriceMinor: 7000,
        startAt: new Date(),
        endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        totalAllocationLimit: 50,
        perCustomerLifetimeLimit: 5,
        isActive: true,
      }),
    );
    if (created) {
      summary.offers++;
      const offerProductsRepo = manager.getRepository(OfferProduct);
      await offerProductsRepo.save(offerProductsRepo.create({ offerId: offer.id, productId: baladiEggs.id }));
    }
    console.log(`    Offer "${offer.name}" ${created ? 'created' : 'already existed'} (flash sale on Baladi Eggs).`);
  }

  // --- Vendor 3: pharmacy (single branch, pickup+delivery, coupon offer) ---
  const { vendor: pharmacyVendor } = await ensureVendor('Al Sharq Pharmacy', 'صيدلية الشرق');
  const pharmacyBranch = await ensureBranch(pharmacyVendor, {
    name: 'الفرع الرئيسي',
    address: 'شارع الجلاء، بلبيس، الشرقية',
    latitude: 30.414,
    longitude: 31.567,
    sector: sectors.pharmacy,
    deliveryEnabled: true,
    pickupEnabled: true,
    isOpen: true,
    commissionRateBasisPoints: 500,
    preparationTimeMinutes: 15,
    openingHours: dailyHoursStandard,
  });
  const medicinesCategory = await ensureCategory(pharmacyBranch, 'أدوية', 'أدوية', 0);
  const personalCareCategory = await ensureCategory(pharmacyBranch, 'عناية شخصية', 'عناية شخصية', 1);

  await ensureProduct(pharmacyBranch, medicinesCategory, {
    name: 'Paracetamol 500mg (strip)',
    nameAr: 'باراسيتامول 500 مج (شريط)',
    priceMinor: 1000,
    inventoryMode: InventoryMode.TRACKED,
    quantity: 500,
  });
  await ensureProduct(pharmacyBranch, medicinesCategory, {
    name: 'Vitamin C Effervescent',
    nameAr: 'فيتامين سي فوار',
    priceMinor: 3500,
    inventoryMode: InventoryMode.TRACKED,
    quantity: 200,
  });
  await ensureProduct(pharmacyBranch, personalCareCategory, {
    name: 'Hand Sanitizer 500ml',
    nameAr: 'معقم أيدي 500 مل',
    priceMinor: 4000,
    inventoryMode: InventoryMode.TRACKED,
    quantity: 100,
  });
  await ensureProduct(pharmacyBranch, personalCareCategory, {
    name: 'Baby Shampoo',
    nameAr: 'شامبو أطفال',
    priceMinor: 5500,
    inventoryMode: InventoryMode.TRACKED,
    quantity: 80,
  });

  // Coupon-gated SUBTOTAL_DISCOUNT — never auto-applied; the customer must enter the code at checkout.
  {
    const { row: offer, created } = await findOrCreate(
      manager,
      Offer,
      { vendorBranchId: pharmacyBranch.id, name: 'كود خصم الشرق' },
      () => ({
        vendorBranchId: pharmacyBranch.id,
        name: 'كود خصم الشرق',
        mechanism: OfferMechanism.SUBTOTAL_DISCOUNT,
        discountType: DiscountType.PERCENTAGE,
        discountValue: 1000, // 10.00%
        minimumEligibleSubtotalMinor: 2000,
        maximumDiscountMinor: 2000,
        couponCode: 'HATLY10',
        startAt: new Date(),
        endAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        isActive: true,
      }),
    );
    if (created) summary.offers++;
    console.log(`    Offer "${offer.name}" ${created ? 'created' : 'already existed'} (coupon HATLY10).`);
  }

  // --- Vendor 4: bakery (single branch, delivery only, weight + options product) ---
  const { vendor: bakeryVendor } = await ensureVendor('Al Ahl Al Dahabi Bakery', 'مخبز أهل الذهبي', ['Al Forn Al Dahabi Bakery']); // the name on its logo
  const bakeryBranch = await ensureBranch(bakeryVendor, {
    name: 'الفرع الرئيسي',
    address: 'شارع السكة الجديد، بلبيس، الشرقية',
    latitude: 30.419,
    longitude: 31.563,
    sector: sectors.bakery,
    deliveryEnabled: true,
    pickupEnabled: false,
    isOpen: true,
    commissionRateBasisPoints: 700,
    preparationTimeMinutes: 20,
    openingHours: dailyHoursStandard,
  });
  const breadCategory = await ensureCategory(bakeryBranch, 'خبز', 'خبز', 0);
  const pastryCategory = await ensureCategory(bakeryBranch, 'معجنات', 'معجنات', 1);

  await ensureProduct(bakeryBranch, breadCategory, {
    name: 'Baladi Bread (kg)',
    nameAr: 'عيش بلدي (كيلو)',
    priceMinor: 1000, // per kg
    pricingUnit: PricingUnit.WEIGHT,
  });
  const cheeseCroissant = await ensureProduct(bakeryBranch, pastryCategory, {
    name: 'Cheese Croissant',
    nameAr: 'كرواسون جبنة',
    priceMinor: 1500,
  });
  await ensureOption(cheeseCroissant, 'Extras', 'إضافات', false, true, [
    { name: 'Extra cheese', nameAr: 'جبنة إضافية', priceDeltaMinor: 500 },
    { name: 'Zaatar', nameAr: 'زعتر', priceDeltaMinor: 300 },
  ]);
  await ensureProduct(bakeryBranch, pastryCategory, { name: 'Chocolate Cake', nameAr: 'كيك شوكولاتة', priceMinor: 18000 });
  await ensureProduct(bakeryBranch, pastryCategory, { name: 'Almond Biscuits', nameAr: 'بسكويت باللوز', priceMinor: 6000 });

  // =======================================================================
  // DEV MARKETPLACE EXPANSION (pre-demo dataset) — same helpers, same
  // idempotency contract, same service area. Adds: a 2nd/3rd vendor to every
  // existing sector (restaurants now has 3), plus 3 brand-new sectors (meat &
  // poultry, produce, household), each with 2 vendors — so every sector has
  // multiple vendors and every vendor has a realistic, varied product catalog.
  // =======================================================================

  // --- Vendor 5: restaurant #2 — grills (required-MULTI-choice example: "choose at least one sauce") ---
  const { vendor: grillsVendor } = await ensureVendor('Abu Aly Grills', 'مطعم أبو علي للمشويات');
  const grillsBranch = await ensureBranch(grillsVendor, {
    name: 'الفرع الرئيسي',
    address: 'شارع الأمير فاروق، بلبيس، الشرقية',
    latitude: 30.4225,
    longitude: 31.5595,
    sector: sectors.restaurants,
    deliveryEnabled: true,
    pickupEnabled: true,
    isOpen: true,
    commissionRateBasisPoints: 1000,
    preparationTimeMinutes: 25,
    openingHours: dailyHoursStandard,
    ratingCount: 64,
    ratingSumStars: 275, // avg ≈ 4.30
  });
  const grillsMainsCategory = await ensureCategory(grillsBranch, 'المشويات', 'المشويات', 0);
  const grillsSandwichesCategory = await ensureCategory(grillsBranch, 'ساندويتشات', 'ساندويتشات', 1);
  const grillsSidesCategory = await ensureCategory(grillsBranch, 'أطباق جانبية', 'أطباق جانبية', 2);

  const koftaProduct = await ensureProduct(grillsBranch, grillsMainsCategory, {
    name: 'Kofta',
    nameAr: 'كفتة',
    priceMinor: 11000,
    ratingCount: 20,
    ratingSumStars: 90, // avg 4.5
  });
  await ensureProduct(grillsBranch, grillsMainsCategory, { name: 'Kebab', nameAr: 'كباب', priceMinor: 13000 });
  const shawarmaSandwich = await ensureProduct(grillsBranch, grillsSandwichesCategory, {
    name: 'Chicken Shawarma Sandwich',
    nameAr: 'ساندويتش شاورما فراخ',
    priceMinor: 4500,
  });
  // Required + allowsMultiple: the customer MUST pick at least one sauce, but may pick several — the
  // "required multiple-choice" combination, distinct from the required-single-choice example above.
  await ensureOption(shawarmaSandwich, 'Choose sauce', 'اختر الصوص', true, true, [
    { name: 'Garlic sauce', nameAr: 'ثومية', priceDeltaMinor: 0 },
    { name: 'Tahini', nameAr: 'طحينة', priceDeltaMinor: 0 },
    { name: 'Ketchup', nameAr: 'كاتشب', priceDeltaMinor: 0 },
    { name: 'Mayonnaise', nameAr: 'مايونيز', priceDeltaMinor: 0 },
  ]);
  await ensureProduct(grillsBranch, grillsSidesCategory, { name: 'Grilled Rice', nameAr: 'أرز محمر', priceMinor: 1800 });
  await ensureProduct(grillsBranch, grillsSidesCategory, { name: 'Tahini Salad', nameAr: 'سلطة طحينة', priceMinor: 1200 });
  await ensureProduct(grillsBranch, grillsSidesCategory, { name: 'Soft Drink Can', nameAr: 'مشروب غازي', priceMinor: 1000 });

  {
    const { row: offer, created } = await findOrCreate(
      manager,
      Offer,
      { vendorBranchId: grillsBranch.id, name: 'عرض الكفتة' },
      () => ({
        vendorBranchId: grillsBranch.id,
        name: 'عرض الكفتة',
        mechanism: OfferMechanism.FLASH_SALE,
        specialPriceMinor: 9000,
        startAt: new Date(),
        endAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        totalAllocationLimit: 40,
        perCustomerLifetimeLimit: 3,
        isActive: true,
      }),
    );
    if (created) {
      summary.offers++;
      const offerProductsRepo = manager.getRepository(OfferProduct);
      await offerProductsRepo.save(offerProductsRepo.create({ offerId: offer.id, productId: koftaProduct.id }));
    }
    console.log(`    Offer "${offer.name}" ${created ? 'created' : 'already existed'} (flash sale on Kofta).`);
  }

  // --- Vendor 6: restaurant #3 — pizza (required-single + optional-multi COMBINATION example, and a
  //     second, separate required-single-only example on a different product) ---
  const { vendor: pizzaVendor } = await ensureVendor('Flatini Pizza', 'بيتزا فلاتيني');
  const pizzaBranch = await ensureBranch(pizzaVendor, {
    name: 'الفرع الرئيسي',
    address: 'شارع النصر، بلبيس، الشرقية',
    latitude: 30.415,
    longitude: 31.5705,
    sector: sectors.restaurants,
    deliveryEnabled: true,
    pickupEnabled: true,
    isOpen: true,
    commissionRateBasisPoints: 1000,
    preparationTimeMinutes: 22,
    openingHours: dailyHoursStandard,
    ratingCount: 51,
    ratingSumStars: 240, // avg ≈ 4.71
  });
  const pizzaMainsCategory = await ensureCategory(pizzaBranch, 'بيتزا', 'بيتزا', 0);
  const pizzaSidesCategory = await ensureCategory(pizzaBranch, 'أطباق جانبية', 'أطباق جانبية', 1);
  const pizzaDrinksCategory = await ensureCategory(pizzaBranch, 'مشروبات', 'مشروبات', 2);

  const margherita = await ensureProduct(pizzaBranch, pizzaMainsCategory, {
    name: 'Margherita Pizza',
    nameAr: 'بيتزا مارجريتا',
    priceMinor: 12000,
    ratingCount: 30,
    ratingSumStars: 140, // avg ≈ 4.67
  });
  await ensureOption(margherita, 'Size', 'الحجم', true, false, [
    { name: 'Small', nameAr: 'صغير', priceDeltaMinor: 0 },
    { name: 'Medium', nameAr: 'وسط', priceDeltaMinor: 3000 },
    { name: 'Large', nameAr: 'كبير', priceDeltaMinor: 6000 },
  ]);
  await ensureOption(margherita, 'Toppings', 'الإضافات', false, true, [
    { name: 'Mushrooms', nameAr: 'فطر', priceDeltaMinor: 1000 },
    { name: 'Olives', nameAr: 'زيتون', priceDeltaMinor: 800 },
    { name: 'Extra cheese', nameAr: 'جبنة إضافية', priceDeltaMinor: 1500 },
    { name: 'Jalapeños', nameAr: 'فلفل حار', priceDeltaMinor: 800 },
  ]);
  const pepperoni = await ensureProduct(pizzaBranch, pizzaMainsCategory, {
    name: 'Pepperoni Pizza',
    nameAr: 'بيتزا ببروني',
    priceMinor: 14000,
  });
  await ensureOption(pepperoni, 'Size', 'الحجم', true, false, [
    { name: 'Small', nameAr: 'صغير', priceDeltaMinor: 0 },
    { name: 'Medium', nameAr: 'وسط', priceDeltaMinor: 3000 },
    { name: 'Large', nameAr: 'كبير', priceDeltaMinor: 6000 },
  ]);
  await ensureProduct(pizzaBranch, pizzaSidesCategory, { name: 'Garlic Bread', nameAr: 'خبز بالثوم', priceMinor: 4500 });
  await ensureProduct(pizzaBranch, pizzaSidesCategory, { name: 'Caesar Salad', nameAr: 'سلطة سيزر', priceMinor: 5500 });
  await ensureProduct(pizzaBranch, pizzaDrinksCategory, { name: 'Iced Tea', nameAr: 'شاي مثلج', priceMinor: 1200 });

  // --- Vendor 7: groceries #2 (single branch) ---
  const { vendor: miniMarketVendor } = await ensureVendor('Al Amana Minimarket', 'ميني ماركت الأمانة');
  const miniMarketBranch = await ensureBranch(miniMarketVendor, {
    name: 'الفرع الرئيسي',
    address: 'شارع طلعت حرب، بلبيس، الشرقية',
    latitude: 30.4145,
    longitude: 31.5545,
    sector: sectors.groceries,
    deliveryEnabled: true,
    pickupEnabled: true,
    isOpen: true,
    commissionRateBasisPoints: 800,
    preparationTimeMinutes: 18,
    openingHours: dailyHoursStandard,
  });
  const miniMarketPantry = await ensureCategory(miniMarketBranch, 'بقالة جافة', 'بقالة جافة', 0);
  const miniMarketProduce = await ensureCategory(miniMarketBranch, 'خضار وفاكهة', 'خضار وفاكهة', 1);

  await ensureProduct(miniMarketBranch, miniMarketPantry, {
    name: 'Pasta 1kg', nameAr: 'مكرونة 1 كيلو', priceMinor: 3000, inventoryMode: InventoryMode.TRACKED, quantity: 120,
  });
  await ensureProduct(miniMarketBranch, miniMarketPantry, {
    name: 'Sugar 1kg', nameAr: 'سكر 1 كيلو', priceMinor: 2800, inventoryMode: InventoryMode.TRACKED, quantity: 150,
  });
  await ensureProduct(miniMarketBranch, miniMarketPantry, {
    name: 'Tea Bags (100)', nameAr: 'شاي أكياس (100)', priceMinor: 8500, inventoryMode: InventoryMode.TRACKED, quantity: 60,
  });
  await ensureProduct(miniMarketBranch, miniMarketPantry, {
    name: 'Canned Tuna', nameAr: 'تونة معلبة', priceMinor: 4200, inventoryMode: InventoryMode.TRACKED, quantity: 90,
  });
  await ensureProduct(miniMarketBranch, miniMarketProduce, { name: 'Potatoes', nameAr: 'بطاطس', priceMinor: 1500, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(miniMarketBranch, miniMarketProduce, { name: 'Onions', nameAr: 'بصل', priceMinor: 1200, pricingUnit: PricingUnit.WEIGHT });

  {
    const { row: offer, created } = await findOrCreate(
      manager,
      Offer,
      { vendorBranchId: miniMarketBranch.id, name: 'خصم الأمانة' },
      () => ({
        vendorBranchId: miniMarketBranch.id,
        name: 'خصم الأمانة',
        mechanism: OfferMechanism.SUBTOTAL_DISCOUNT,
        discountType: DiscountType.FIXED,
        discountValue: 1000, // 10 EGP off
        minimumEligibleSubtotalMinor: 6000,
        maximumDiscountMinor: 1000,
        startAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isActive: true,
      }),
    );
    if (created) summary.offers++;
    console.log(`    Offer "${offer.name}" ${created ? 'created' : 'already existed'} (fixed 10 EGP off, no coupon).`);
  }

  // --- Vendor 8: pharmacy #2 (single branch) ---
  const { vendor: noorPharmacyVendor } = await ensureVendor('Al Noor Pharmacy', 'صيدلية النور');
  const noorPharmacyBranch = await ensureBranch(noorPharmacyVendor, {
    name: 'الفرع الرئيسي',
    address: 'شارع الاستاد، بلبيس، الشرقية',
    latitude: 30.4235,
    longitude: 31.5665,
    sector: sectors.pharmacy,
    deliveryEnabled: true,
    pickupEnabled: true,
    isOpen: true,
    commissionRateBasisPoints: 500,
    preparationTimeMinutes: 15,
    openingHours: dailyHoursStandard,
    ratingCount: 22,
    ratingSumStars: 92, // avg ≈ 4.18
  });
  const noorMedicinesCategory = await ensureCategory(noorPharmacyBranch, 'أدوية', 'أدوية', 0);
  const noorCareCategory = await ensureCategory(noorPharmacyBranch, 'عناية شخصية', 'عناية شخصية', 1);

  await ensureProduct(noorPharmacyBranch, noorMedicinesCategory, {
    name: 'Ibuprofen 400mg (strip)', nameAr: 'إيبوبروفين 400 مج (شريط)', priceMinor: 1200, inventoryMode: InventoryMode.TRACKED, quantity: 300,
  });
  await ensureProduct(noorPharmacyBranch, noorMedicinesCategory, {
    name: 'Cough Syrup', nameAr: 'شراب للكحة', priceMinor: 2800, inventoryMode: InventoryMode.TRACKED, quantity: 120,
  });
  await ensureProduct(noorPharmacyBranch, noorMedicinesCategory, {
    name: 'Vitamin D Drops', nameAr: 'نقط فيتامين د', priceMinor: 4500, inventoryMode: InventoryMode.TRACKED, quantity: 90,
  });
  await ensureProduct(noorPharmacyBranch, noorCareCategory, {
    name: 'Face Masks (50)', nameAr: 'كمامات (50)', priceMinor: 3000, inventoryMode: InventoryMode.TRACKED, quantity: 200,
  });
  await ensureProduct(noorPharmacyBranch, noorCareCategory, {
    name: 'Antiseptic Solution 250ml', nameAr: 'محلول مطهر 250 مل', priceMinor: 3500, inventoryMode: InventoryMode.TRACKED, quantity: 100,
  });

  // --- Vendor 9: bakery #2 — patisserie (2nd required-single + optional-multi COMBINATION example) ---
  const { vendor: patisserieVendor } = await ensureVendor('Al Sharkia Patisserie', 'حلواني الشرقية');
  const patisserieBranch = await ensureBranch(patisserieVendor, {
    name: 'الفرع الرئيسي',
    address: 'شارع الجيش، بلبيس، الشرقية',
    latitude: 30.4195,
    longitude: 31.5525,
    sector: sectors.bakery,
    deliveryEnabled: true,
    pickupEnabled: true,
    isOpen: true,
    commissionRateBasisPoints: 700,
    preparationTimeMinutes: 20,
    openingHours: dailyHoursStandard,
  });
  const patisserieOrientalCategory = await ensureCategory(patisserieBranch, 'حلويات شرقية', 'حلويات شرقية', 0);
  const patisserieCakesCategory = await ensureCategory(patisserieBranch, 'تورت', 'تورت', 1);

  await ensureProduct(patisserieBranch, patisserieOrientalCategory, { name: 'Basbousa', nameAr: 'بسبوسة', priceMinor: 1200, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(patisserieBranch, patisserieOrientalCategory, { name: 'Kunafa', nameAr: 'كنافة', priceMinor: 1800, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(patisserieBranch, patisserieOrientalCategory, { name: 'Baklava Box', nameAr: 'علبة بقلاوة', priceMinor: 9000, inventoryMode: InventoryMode.TRACKED, quantity: 40 });
  const birthdayCake = await ensureProduct(patisserieBranch, patisserieCakesCategory, {
    name: 'Birthday Cake', nameAr: 'تورتة عيد ميلاد', priceMinor: 25000,
  });
  await ensureOption(birthdayCake, 'Size', 'الحجم', true, false, [
    { name: 'Serves 8', nameAr: 'يكفي 8 أفراد', priceDeltaMinor: 0 },
    { name: 'Serves 15', nameAr: 'يكفي 15 فرد', priceDeltaMinor: 15000 },
    { name: 'Serves 25', nameAr: 'يكفي 25 فرد', priceDeltaMinor: 30000 },
  ]);
  await ensureOption(birthdayCake, 'Toppings', 'التوبينج', false, true, [
    { name: 'Chocolate', nameAr: 'شوكولاتة', priceDeltaMinor: 2000 },
    { name: 'Strawberry', nameAr: 'فراولة', priceDeltaMinor: 2500 },
    { name: 'Mixed nuts', nameAr: 'مكسرات', priceDeltaMinor: 3000 },
  ]);

  {
    const { row: offer, created } = await findOrCreate(
      manager,
      Offer,
      { vendorBranchId: patisserieBranch.id, name: 'كود خصم الشرقية' },
      () => ({
        vendorBranchId: patisserieBranch.id,
        name: 'كود خصم الشرقية',
        mechanism: OfferMechanism.SUBTOTAL_DISCOUNT,
        discountType: DiscountType.PERCENTAGE,
        discountValue: 1500, // 15.00%
        minimumEligibleSubtotalMinor: 10000,
        maximumDiscountMinor: 5000,
        couponCode: 'SWEET15',
        startAt: new Date(),
        endAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
        isActive: true,
      }),
    );
    if (created) summary.offers++;
    console.log(`    Offer "${offer.name}" ${created ? 'created' : 'already existed'} (coupon SWEET15).`);
  }

  // --- Vendor 10 & 11: Meat & Poultry (new sector) ---
  const { vendor: butcheryVendor } = await ensureVendor('Al Ferdaws Butchery', 'جزارة الفردوس');
  const butcheryBranch = await ensureBranch(butcheryVendor, {
    name: 'الفرع الرئيسي',
    address: 'شارع السوق، بلبيس، الشرقية',
    latitude: 30.417,
    longitude: 31.5685,
    sector: sectors['meat-poultry'],
    deliveryEnabled: true,
    pickupEnabled: true,
    isOpen: true,
    commissionRateBasisPoints: 600,
    preparationTimeMinutes: 15,
    openingHours: dailyHoursStandard,
    ratingCount: 38,
    ratingSumStars: 175, // avg ≈ 4.61
  });
  const butcheryCategory = await ensureCategory(butcheryBranch, 'لحوم طازجة', 'لحوم طازجة', 0);
  const beefProduct = await ensureProduct(butcheryBranch, butcheryCategory, {
    name: 'Beef', nameAr: 'لحم بقري', priceMinor: 28000, pricingUnit: PricingUnit.WEIGHT,
    ratingCount: 12, ratingSumStars: 54, // avg 4.5
  });
  await ensureProduct(butcheryBranch, butcheryCategory, { name: 'Lamb', nameAr: 'لحم ضاني', priceMinor: 35000, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(butcheryBranch, butcheryCategory, { name: 'Minced Meat', nameAr: 'لحم مفروم', priceMinor: 26000, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(butcheryBranch, butcheryCategory, { name: 'Veal Liver', nameAr: 'كبدة بتلو', priceMinor: 22000, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(butcheryBranch, butcheryCategory, { name: 'Beef Bones (for stock)', nameAr: 'عضم بقري (للشوربة)', priceMinor: 9000, pricingUnit: PricingUnit.WEIGHT });

  const { vendor: poultryVendor } = await ensureVendor('Belbeis Poultry', 'دواجن بلبيس');
  const poultryBranch = await ensureBranch(poultryVendor, {
    name: 'الفرع الرئيسي',
    address: 'شارع السوق التجاري، بلبيس، الشرقية',
    latitude: 30.4115,
    longitude: 31.564,
    sector: sectors['meat-poultry'],
    deliveryEnabled: true,
    pickupEnabled: false,
    isOpen: true,
    commissionRateBasisPoints: 600,
    preparationTimeMinutes: 15,
    openingHours: dailyHoursStandard,
  });
  const poultryCategory = await ensureCategory(poultryBranch, 'دواجن طازجة', 'دواجن طازجة', 0);
  await ensureProduct(poultryBranch, poultryCategory, {
    name: 'Whole Chicken', nameAr: 'فرخة كاملة', priceMinor: 15000, inventoryMode: InventoryMode.TRACKED, quantity: 60,
  });
  await ensureProduct(poultryBranch, poultryCategory, { name: 'Chicken Breast', nameAr: 'صدور فراخ', priceMinor: 18000, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(poultryBranch, poultryCategory, { name: 'Chicken Wings', nameAr: 'أجنحة فراخ', priceMinor: 14000, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(poultryBranch, poultryCategory, {
    name: 'Turkey', nameAr: 'ديك رومي', priceMinor: 22000, inventoryMode: InventoryMode.TRACKED, quantity: 20,
  });

  {
    const { row: offer, created } = await findOrCreate(
      manager,
      Offer,
      { vendorBranchId: butcheryBranch.id, name: 'عرض اللحم البقري' },
      () => ({
        vendorBranchId: butcheryBranch.id,
        name: 'عرض اللحم البقري',
        mechanism: OfferMechanism.FLASH_SALE,
        specialPriceMinor: 24000,
        startAt: new Date(),
        endAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        totalAllocationLimit: 100,
        perCustomerLifetimeLimit: 5,
        isActive: true,
      }),
    );
    if (created) {
      summary.offers++;
      const offerProductsRepo = manager.getRepository(OfferProduct);
      await offerProductsRepo.save(offerProductsRepo.create({ offerId: offer.id, productId: beefProduct.id }));
    }
    console.log(`    Offer "${offer.name}" ${created ? 'created' : 'already existed'} (flash sale on Beef).`);
  }

  // --- Vendor 12 & 13: Fruits & Vegetables (new sector) ---
  const { vendor: greengrocerVendor } = await ensureVendor('Al Gomhoria Grocery', 'خضري الجمهورية', ['Al Gomhoria Greengrocer']); // the name on its logo
  const greengrocerBranch = await ensureBranch(greengrocerVendor, {
    name: 'الفرع الرئيسي',
    address: 'شارع الجمهورية، بلبيس، الشرقية',
    latitude: 30.4188,
    longitude: 31.5608,
    sector: sectors.produce,
    deliveryEnabled: true,
    pickupEnabled: true,
    isOpen: true,
    commissionRateBasisPoints: 500,
    preparationTimeMinutes: 10,
    openingHours: dailyHoursStandard,
  });
  const greengrocerCategory = await ensureCategory(greengrocerBranch, 'خضروات', 'خضروات', 0);
  await ensureProduct(greengrocerBranch, greengrocerCategory, { name: 'Tomatoes', nameAr: 'طماطم', priceMinor: 2500, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(greengrocerBranch, greengrocerCategory, { name: 'Potatoes', nameAr: 'بطاطس', priceMinor: 1500, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(greengrocerBranch, greengrocerCategory, { name: 'Carrots', nameAr: 'جزر', priceMinor: 1800, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(greengrocerBranch, greengrocerCategory, { name: 'Green Peppers', nameAr: 'فلفل أخضر', priceMinor: 2200, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(greengrocerBranch, greengrocerCategory, { name: 'Lemons', nameAr: 'ليمون', priceMinor: 3000, pricingUnit: PricingUnit.WEIGHT });

  const { vendor: fruitShopVendor } = await ensureVendor('Al Saada Fruit Shop', 'فاكهاني السعادة');
  const fruitShopBranch = await ensureBranch(fruitShopVendor, {
    name: 'الفرع الرئيسي',
    address: 'ميدان السعادة، بلبيس، الشرقية',
    latitude: 30.4212,
    longitude: 31.5535,
    sector: sectors.produce,
    deliveryEnabled: true,
    pickupEnabled: true,
    isOpen: true,
    commissionRateBasisPoints: 500,
    preparationTimeMinutes: 10,
    openingHours: dailyHoursStandard,
    ratingCount: 15,
    ratingSumStars: 60, // avg 4.0
  });
  const fruitShopCategory = await ensureCategory(fruitShopBranch, 'فاكهة', 'فاكهة', 0);
  await ensureProduct(fruitShopBranch, fruitShopCategory, { name: 'Bananas', nameAr: 'موز', priceMinor: 2000, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(fruitShopBranch, fruitShopCategory, { name: 'Oranges', nameAr: 'برتقال', priceMinor: 1800, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(fruitShopBranch, fruitShopCategory, { name: 'Apples', nameAr: 'تفاح', priceMinor: 3500, pricingUnit: PricingUnit.WEIGHT });
  const mangoesProduct = await ensureProduct(fruitShopBranch, fruitShopCategory, { name: 'Mangoes', nameAr: 'مانجو', priceMinor: 4500, pricingUnit: PricingUnit.WEIGHT });
  await ensureProduct(fruitShopBranch, fruitShopCategory, { name: 'Grapes', nameAr: 'عنب', priceMinor: 4000, pricingUnit: PricingUnit.WEIGHT });

  {
    const { row: offer, created } = await findOrCreate(
      manager,
      Offer,
      { vendorBranchId: fruitShopBranch.id, name: 'عرض المانجو' },
      () => ({
        vendorBranchId: fruitShopBranch.id,
        name: 'عرض المانجو',
        mechanism: OfferMechanism.FLASH_SALE,
        specialPriceMinor: 3800,
        startAt: new Date(),
        endAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        totalAllocationLimit: 80,
        perCustomerLifetimeLimit: 10,
        isActive: true,
      }),
    );
    if (created) {
      summary.offers++;
      const offerProductsRepo = manager.getRepository(OfferProduct);
      await offerProductsRepo.save(offerProductsRepo.create({ offerId: offer.id, productId: mangoesProduct.id }));
    }
    console.log(`    Offer "${offer.name}" ${created ? 'created' : 'already existed'} (flash sale on Mangoes).`);
  }

  // --- Vendor 14 & 15: Household (new sector) ---
  const { vendor: toolsCenterVendor } = await ensureVendor('Household Tools Center', 'مركز الأدوات المنزلية');
  const toolsCenterBranch = await ensureBranch(toolsCenterVendor, {
    name: 'الفرع الرئيسي',
    address: 'شارع المدارس، بلبيس، الشرقية',
    latitude: 30.4162,
    longitude: 31.5578,
    sector: sectors.household,
    deliveryEnabled: true,
    pickupEnabled: true,
    isOpen: true,
    commissionRateBasisPoints: 700,
    preparationTimeMinutes: 20,
    openingHours: dailyHoursStandard,
  });
  const toolsCleaningCategory = await ensureCategory(toolsCenterBranch, 'أدوات تنظيف', 'أدوات تنظيف', 0);
  const toolsKitchenCategory = await ensureCategory(toolsCenterBranch, 'أدوات مطبخ', 'أدوات مطبخ', 1);
  await ensureProduct(toolsCenterBranch, toolsCleaningCategory, {
    name: 'Cleaning Bucket', nameAr: 'جردل تنظيف', priceMinor: 4500, inventoryMode: InventoryMode.TRACKED, quantity: 50,
  });
  await ensureProduct(toolsCenterBranch, toolsCleaningCategory, {
    name: 'Broom', nameAr: 'مقشة', priceMinor: 3000, inventoryMode: InventoryMode.TRACKED, quantity: 70,
  });
  await ensureProduct(toolsCenterBranch, toolsCleaningCategory, {
    name: 'Dish Soap 1L', nameAr: 'سائل جلي 1 لتر', priceMinor: 3800, inventoryMode: InventoryMode.TRACKED, quantity: 100,
  });
  await ensureProduct(toolsCenterBranch, toolsKitchenCategory, {
    name: 'Cooking Pot', nameAr: 'حلة طبخ', priceMinor: 25000, inventoryMode: InventoryMode.TRACKED, quantity: 25,
  });
  await ensureProduct(toolsCenterBranch, toolsKitchenCategory, {
    name: 'Frying Pan', nameAr: 'طاسة تيفال', priceMinor: 18000, inventoryMode: InventoryMode.TRACKED, quantity: 30,
  });

  const { vendor: bazaarVendor } = await ensureVendor('Al Sharkia Bazaar', 'بازار الشرقية');
  const bazaarBranch = await ensureBranch(bazaarVendor, {
    name: 'الفرع الرئيسي',
    address: 'شارع بورسعيد، بلبيس، الشرقية',
    latitude: 30.4258,
    longitude: 31.5615,
    sector: sectors.household,
    deliveryEnabled: true,
    pickupEnabled: false,
    isOpen: true,
    commissionRateBasisPoints: 700,
    preparationTimeMinutes: 20,
    openingHours: dailyHoursStandard,
  });
  const bazaarGeneralCategory = await ensureCategory(bazaarBranch, 'أدوات منزلية عامة', 'أدوات منزلية عامة', 0);
  await ensureProduct(bazaarBranch, bazaarGeneralCategory, {
    name: 'Plastic Storage Box', nameAr: 'صندوق بلاستيك للتخزين', priceMinor: 6500, inventoryMode: InventoryMode.TRACKED, quantity: 40,
  });
  await ensureProduct(bazaarBranch, bazaarGeneralCategory, {
    name: 'Kitchen Towels (pack of 6)', nameAr: 'فوط مطبخ (6 قطع)', priceMinor: 4000, inventoryMode: InventoryMode.TRACKED, quantity: 80,
  });
  await ensureProduct(bazaarBranch, bazaarGeneralCategory, {
    name: 'Cutting Board', nameAr: 'لوح تقطيع', priceMinor: 5500, inventoryMode: InventoryMode.TRACKED, quantity: 60,
  });
  await ensureProduct(bazaarBranch, bazaarGeneralCategory, {
    name: 'Water Bottle 1L', nameAr: 'زجاجة مياه 1 لتر', priceMinor: 3500, inventoryMode: InventoryMode.TRACKED, quantity: 90,
  });
  await ensureProduct(bazaarBranch, bazaarGeneralCategory, {
    name: 'Extension Cord 5m', nameAr: 'وصلة كهرباء 5 متر', priceMinor: 9500, inventoryMode: InventoryMode.TRACKED, quantity: 35,
  });

  // ---------------------------------------------------------------------
  // 5. Branch <-> subcategory assignments (consolidated customer-commerce
  //    milestone, Part E) — a representative sample, not every branch:
  //    enough for the customer app's subcategory chip row to have real,
  //    non-empty results to filter to in every seeded sector. Demonstrates
  //    the genuine many-to-many (a branch in more than one subcategory).
  // ---------------------------------------------------------------------
  console.log('Step 5: branch subcategory assignments');
  const branchSubcategoryAssignments: Array<[VendorBranch, MarketplaceSubcategory]> = [
    [restaurantBranch, subcategories['restaurants:Oriental']],
    [marketMain, subcategories['groceries:Fresh Produce']],
    [marketMain, subcategories['groceries:Dairy & Eggs']], // same branch, a second subcategory — genuine many-to-many
    [marketStation, subcategories['groceries:Beverages']],
    [pharmacyBranch, subcategories['pharmacy:Medicines & OTC']],
    [pharmacyBranch, subcategories['pharmacy:Personal Care']],
    [noorPharmacyBranch, subcategories['pharmacy:Vitamins & Supplements']],
    [greengrocerBranch, subcategories['produce:Fresh Vegetables']],
    [fruitShopBranch, subcategories['produce:Fresh Fruits']],
  ];
  for (const [branch, subcategory] of branchSubcategoryAssignments) {
    const created = await ensureBranchSubcategory(manager, branch.id, subcategory.id);
    if (created) summary.branchSubcategoryAssignments++;
    console.log(`  Branch "${branch.name}" <-> subcategory "${subcategory.name}" ${created ? 'assigned' : 'already assigned'}.`);
  }

  // ---------------------------------------------------------------------
  // 6. Marketplace media. Applies the committed asset pack (`docs/assets/pack`, or `SEED_MEDIA_DIR` if set), laid out as
  //    `<dir>/<key>.<webp|png|jpg>` (keys: see seed-media.ts / docs/assets/ASSET_MANIFEST.md). Each file present is copied
  //    into the backend's existing uploads directory and its server-relative URL stored.
  //    Reset-safe: a URL this seed stored before (`/uploads/files/marketplace/...`) is re-staged every run, so wiping the
  //    uploads directory and re-seeding restores every image; if its asset left the pack, the stale URL is cleared rather
  //    than left pointing at nothing. A URL set any other way (a real admin upload) is NEVER touched. No URL is ever
  //    invented for an asset that was not delivered (the app's placeholder handles a null column).
  // ---------------------------------------------------------------------
  console.log('Step 6: marketplace media');
  const mediaDir = process.env.SEED_MEDIA_DIR || (existsSync(DEFAULT_MEDIA_DIR) ? DEFAULT_MEDIA_DIR : null);
  const uploadsDir = process.env.UPLOADS_LOCAL_DIR || './uploads-storage';
  if (!mediaDir) {
    console.log('  no asset pack found (SEED_MEDIA_DIR unset, docs/assets/pack absent) — image columns left as they are.');
  } else {
    console.log(`  asset pack: ${mediaDir}`);
    for (const target of await collectMediaTargets(manager)) {
      if (target.currentUrl && !isSeededMediaUrl(target.currentUrl)) continue; // a real upload — never overwritten
      const url = await stageMediaFile({ mediaDir, uploadsDir, key: target.key });
      if (!url) {
        if (target.currentUrl && !(await localUploadExists(uploadsDir, target.currentUrl))) {
          await target.save(null);
          summary.mediaCleared++;
          console.log(`  ${target.kind} "${target.label}": asset no longer in the pack — stale URL cleared`);
        }
        summary.mediaMissing++;
        continue;
      }
      if (url === target.currentUrl) {
        summary.mediaRestaged++;
        continue;
      }
      await target.save(url);
      summary.mediaApplied++;
      console.log(`  ${target.kind} "${target.label}" -> ${url}`);
    }
    console.log(
      `  media applied: ${summary.mediaApplied}, re-staged: ${summary.mediaRestaged}, cleared: ${summary.mediaCleared}, ` +
        `no asset delivered: ${summary.mediaMissing}`,
    );
  }

  // Every stored server-relative image URL must resolve to a file the backend actually serves.
  for (const target of await collectMediaTargets(manager)) {
    if (target.currentUrl && (await localUploadExists(uploadsDir, target.currentUrl)) === false) {
      summary.brokenImageReferences++;
      console.log(`  BROKEN image reference: ${target.kind} "${target.label}" -> ${target.currentUrl}`);
    }
  }
  console.log(`  broken image references: ${summary.brokenImageReferences}`);

  await seedTesterAccounts(manager);

  return summary;
}

/**
 * Tester accounts (Tester & Sales readiness) — one per actor, on fixed phone numbers, created through the same entities the
 * real admin/auth flows write (users + vendor_staff / drivers / admin_permissions). Runs only when TESTER_PASSWORD is set:
 * no password lives in source; every run resets these accounts to that password and their role links, so the tester
 * environment is reproducible. Accounts are matched by phone — re-running never duplicates one.
 */
export const TESTER_ACCOUNTS = {
  customer: { phone: '+201070000001', fullName: 'Hatly Customer Tester', role: Role.CUSTOMER },
  vendor: { phone: '+201070000002', fullName: 'Hatly Vendor Tester', role: Role.VENDOR },
  vendorManager: { phone: '+201070000003', fullName: 'Hatly Vendor Manager Tester', role: Role.VENDOR_MANAGER },
  driver1: { phone: '+201070000004', fullName: 'Hatly Driver Tester 1', role: Role.DRIVER },
  driver2: { phone: '+201070000005', fullName: 'Hatly Driver Tester 2', role: Role.DRIVER },
  admin: { phone: '+201070000006', fullName: 'Hatly Admin Tester', role: Role.ADMIN },
} as const;
/** The vendor whose branch the vendor testers staff: pickup-enabled, and one of the two restaurants of the multi-vendor demo cart. */
export const TESTER_VENDOR_NAME = 'Abu Aly Grills';
/** Operations only (orders, dispatch, pickup fallback, drivers, payments review, Hatly Service pricing, wallet credit for tests). */
export const TESTER_ADMIN_PERMISSIONS: Permission[] = [
  Permission.VIEW_ORDERS,
  Permission.ASSIGN_REASSIGN_ORDERS,
  Permission.MANAGE_ORDER_ISSUES,
  Permission.MANAGE_DRIVERS,
  Permission.VIEW_CUSTOMERS,
  Permission.VERIFY_MANUAL_PAYMENTS,
  Permission.MANAGE_HATLY_SERVICE_PRICING,
  Permission.MANAGE_CUSTOMER_WALLET,
];

async function seedTesterAccounts(manager: EntityManager): Promise<void> {
  console.log('Step 7: tester accounts');
  const password = process.env.TESTER_PASSWORD;
  if (!password) {
    console.log('  TESTER_PASSWORD not set — tester accounts skipped (no password is ever hard-coded).');
    return;
  }
  if (password.length < 8) throw new Error('TESTER_PASSWORD must be at least 8 characters.');
  const passwordHash = await bcrypt.hash(password, 10);

  const ensureUser = async (a: { phone: string; fullName: string; role: Role }): Promise<User> => {
    const existing = await manager.findOne(User, { where: { phone: a.phone } });
    if (existing && existing.role !== a.role) {
      throw new Error(`Tester phone ${a.phone} already belongs to a ${existing.role} account — refusing to change its role.`);
    }
    if (existing) {
      await manager.update(User, existing.id, { passwordHash, fullName: a.fullName, isActive: true, isPhoneVerified: true });
      console.log(`  ${a.role} ${a.phone} reset to TESTER_PASSWORD (${existing.id}).`);
      return manager.findOneOrFail(User, { where: { id: existing.id } });
    }
    const user = await manager.save(
      User,
      manager.create(User, { phone: a.phone, fullName: a.fullName, role: a.role, passwordHash, isActive: true, isPhoneVerified: true }),
    );
    console.log(`  ${a.role} ${a.phone} created (${user.id}).`);
    return user;
  };

  // Customer — with a default address inside the Belbeis service area (same pin as the dev customer's), in the seeded
  // Belbeis delivery zone (`npm run seed:dev-delivery-zones`) so Hatly Service (zone-priced, PD-009) works for the tester too;
  // the pin keeps catalog delivery distance-priced.
  const customer = await ensureUser(TESTER_ACCOUNTS.customer);
  const zone = await manager.findOne(DeliveryZone, { where: { name: DEFAULT_BELBEIS_ZONES[0].name, isActive: true } });
  if (!zone) console.log(`  no active "${DEFAULT_BELBEIS_ZONES[0].name}" delivery zone — run seed:dev-delivery-zones for Hatly Service.`);
  const existingAddress = await manager.findOne(Address, { where: { customerId: customer.id, isDefault: true, isActive: true } });
  if (existingAddress && zone && existingAddress.deliveryZoneId !== zone.id) {
    await manager.update(Address, existingAddress.id, { deliveryZoneId: zone.id });
    console.log(`  customer tester address placed in zone "${zone.name}".`);
  }
  if (!existingAddress) {
    await manager.save(
      Address,
      manager.create(Address, {
        customerId: customer.id,
        label: 'المنزل',
        line1: 'شارع الجمهورية، بلبيس، الشرقية',
        latitude: BELBEIS_CENTER.latitude,
        longitude: BELBEIS_CENTER.longitude,
        governorate: 'الشرقية',
        city: 'بلبيس',
        street: 'شارع الجمهورية',
        deliveryZoneId: zone?.id ?? null,
        isDefault: true,
        isActive: true,
      }),
    );
    console.log(`  customer tester default address created (Belbeis${zone ? `, zone "${zone.name}"` : ''}).`);
  }

  // Vendor + vendor manager — staff of the tester vendor's main branch.
  const vendor = await manager.findOneOrFail(Vendor, { where: { name: TESTER_VENDOR_NAME } });
  const branch = await manager.findOneOrFail(VendorBranch, { where: { vendorId: vendor.id }, order: { createdAt: 'ASC' } });
  for (const a of [TESTER_ACCOUNTS.vendor, TESTER_ACCOUNTS.vendorManager]) {
    const user = await ensureUser(a);
    const staff = await manager.findOne(VendorStaff, { where: { userId: user.id } });
    if (!staff) await manager.save(VendorStaff, manager.create(VendorStaff, { userId: user.id, vendorBranchId: branch.id }));
    else if (staff.vendorBranchId !== branch.id) await manager.update(VendorStaff, staff.id, { vendorBranchId: branch.id });
  }
  console.log(`  vendor testers staff "${TESTER_VENDOR_NAME}" (${branch.id}).`);

  // Drivers — approved; a NEW driver is available (Control Tower rule). Availability of an existing driver is never
  // touched: it follows their active delivery (availability invariant). They go online from the Driver app.
  for (const a of [TESTER_ACCOUNTS.driver1, TESTER_ACCOUNTS.driver2]) {
    const user = await ensureUser(a);
    const driver = await manager.findOne(Driver, { where: { userId: user.id } });
    if (!driver) await manager.save(Driver, manager.create(Driver, { userId: user.id, isAvailable: true, verificationStatus: 'APPROVED' }));
    else if (driver.verificationStatus !== 'APPROVED') await manager.update(Driver, driver.id, { verificationStatus: 'APPROVED' });
  }
  console.log('  driver testers approved.');

  // Admin — exactly the operations permission set (extra grants removed, missing ones added).
  const admin = await ensureUser(TESTER_ACCOUNTS.admin);
  const granted = await manager.find(AdminPermission, { where: { userId: admin.id } });
  for (const g of granted) if (!TESTER_ADMIN_PERMISSIONS.includes(g.permission as Permission)) await manager.delete(AdminPermission, g.id);
  for (const p of TESTER_ADMIN_PERMISSIONS) {
    if (!granted.some((g) => g.permission === p)) await manager.save(AdminPermission, manager.create(AdminPermission, { userId: admin.id, permission: p }));
  }
  console.log(`  admin tester permissions: ${TESTER_ADMIN_PERMISSIONS.join(', ')}.`);
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await assertDevDatabase(AppDataSource);
    const summary = await AppDataSource.transaction(async (manager) => seed(manager));
    console.log('\nSeed complete.');
    console.log(JSON.stringify(summary, null, 2));
    if (summary.brokenImageReferences > 0) process.exitCode = 1;
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('Dev marketplace seed failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
