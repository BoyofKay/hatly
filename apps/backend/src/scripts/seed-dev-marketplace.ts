import { DataSource, EntityManager } from 'typeorm';
import { AppDataSource } from '../database/data-source';
import { User } from '../modules/users/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { Address } from '../modules/addresses/entities/address.entity';
import { ServiceArea } from '../modules/service-areas/entities/service-area.entity';
import { MarketplaceSector } from '../modules/sectors/entities/marketplace-sector.entity';
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

interface SeedSummary {
  sectors: number;
  vendors: number;
  branches: number;
  categories: number;
  products: number;
  options: number;
  optionValues: number;
  catalogProducts: number;
  offers: number;
}

async function seed(manager: EntityManager): Promise<SeedSummary> {
  const summary: SeedSummary = {
    sectors: 0,
    vendors: 0,
    branches: 0,
    categories: 0,
    products: 0,
    options: 0,
    optionValues: 0,
    catalogProducts: 0,
    offers: 0,
  };

  // ---------------------------------------------------------------------
  // 0. Development-only checkout configuration these flows genuinely need
  //    (REGISTERED_VENDOR_* are `getRequired` in DeliveryFeeCalculationService
  //    — without them, EVERY delivery checkout quote fails closed with
  //    `DELIVERY_FEE_UNAVAILABLE`, regardless of vendor data). Same values
  //    the project's own e2e test fixtures already use
  //    (`Scenario.configureDeliveryPricing`'s defaults) — nothing invented.
  // ---------------------------------------------------------------------
  console.log('Step 0: business configuration (only fills keys nobody has set yet)');
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

  async function ensureVendor(name: string, nameAr: string): Promise<{ vendor: Vendor; created: boolean }> {
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
  const { vendor: bakeryVendor } = await ensureVendor('Al Forn Al Dahabi Bakery', 'مخبز الفرن الذهبي');
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

  return summary;
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await assertDevDatabase(AppDataSource);
    const summary = await AppDataSource.transaction(async (manager) => seed(manager));
    console.log('\nSeed complete.');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('Dev marketplace seed failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
