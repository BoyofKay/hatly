import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { ProductOption } from './entities/product-option.entity';
import { ProductOptionValue } from './entities/product-option-value.entity';
import {
  CreateProductOptionDto,
  MAX_OPTION_GROUPS_PER_PRODUCT,
  MAX_VALUES_PER_OPTION_GROUP,
  ProductOptionValueDto,
  UpdateProductOptionDto,
  UpdateProductOptionValueDto,
} from './dto/product-option.dto';

/** The caller's proof that they may manage THIS product (admin: a permission, already checked; vendor: owns the branch). */
export type ProductAuthorizer = (product: Product) => Promise<void>;

interface GroupShape {
  isRequired: boolean;
  allowsMultiple: boolean;
  minSelections: number;
  maxSelections: number | null;
}

/**
 * Management of a product's option groups ("modifiers") and their values. The same service backs the admin API (MANAGE_CATALOG) and the
 * vendor API (the vendor must own the product's branch): every method loads the product's REAL owner from the database and hands it to the
 * caller's authorizer — a client-supplied branch id is never trusted, and a product that is not the caller's is simply "not found".
 *
 * Rules enforced here (the customer app only mirrors them; the cart and checkout re-validate with the same effective limits):
 *  - names are unique within the product (groups) / the group (values), case-insensitively;
 *  - a price is an integer in minor units, bounded, and `base + delta` can never be negative;
 *  - the limits are coherent: a single-choice group allows at most one and needs no maximum; a multiple-choice maximum is ≥ max(min, 1);
 *    a group can never require more choices than it has values, and a required group always keeps at least one value;
 *  - removing a value / group removes it from any cart that held it (order snapshots are independent copies and never change); a cart
 *    that then lacks a required choice is refused at checkout until the customer chooses again.
 */
@Injectable()
export class ProductOptionsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(ProductOption) private readonly options: Repository<ProductOption>,
    @InjectRepository(ProductOptionValue) private readonly values: Repository<ProductOptionValue>,
  ) {}

  // ---- reads -------------------------------------------------------------------------------------------------------------------

  async list(productId: string, authorize: ProductAuthorizer): Promise<ProductOption[]> {
    const product = await this.requireProduct(productId, authorize);
    return this.loadGroups(this.dataSource.manager, product.id);
  }

  // ---- groups ------------------------------------------------------------------------------------------------------------------

  async createOption(productId: string, dto: CreateProductOptionDto, authorize: ProductAuthorizer): Promise<ProductOption> {
    return this.dataSource.transaction(async (manager) => {
      const product = await this.requireProduct(productId, authorize, manager, true);
      const existing = await this.loadGroups(manager, product.id);
      if (existing.length >= MAX_OPTION_GROUPS_PER_PRODUCT) {
        throw this.bad('TOO_MANY_OPTION_GROUPS', `A product can have at most ${MAX_OPTION_GROUPS_PER_PRODUCT} option groups.`);
      }
      const name = this.cleanName(dto.name, 'Option group name');
      this.assertUniqueName(existing.map((o) => o.name), name, 'OPTION_NAME_TAKEN', 'This product already has an option group with that name.');

      const shape = this.normalizeShape({
        isRequired: dto.isRequired ?? false,
        allowsMultiple: dto.allowsMultiple ?? false,
        minSelections: dto.minSelections ?? 0,
        maxSelections: dto.maxSelections ?? null,
      });
      const valueDtos = dto.values ?? [];
      this.assertValuesValid(valueDtos, Number(product.priceMinor));
      this.assertShapeFitsValueCount(shape, valueDtos.length);

      const option = await manager.save(
        ProductOption,
        manager.create(ProductOption, { productId: product.id, name, nameAr: dto.nameAr?.trim() || null, ...shape }),
      );
      for (const v of valueDtos) {
        await manager.save(
          ProductOptionValue,
          manager.create(ProductOptionValue, { optionId: option.id, name: v.name.trim(), nameAr: v.nameAr?.trim() || null, priceDeltaMinor: v.priceDeltaMinor ?? 0 }),
        );
      }
      return (await this.loadGroup(manager, option.id))!;
    });
  }

  async updateOption(optionId: string, dto: UpdateProductOptionDto, authorize: ProductAuthorizer): Promise<ProductOption> {
    return this.dataSource.transaction(async (manager) => {
      const option = await this.requireOption(optionId, manager);
      const product = await this.requireProduct(option.productId, authorize, manager, true);
      const siblings = (await this.loadGroups(manager, product.id)).filter((o) => o.id !== option.id);

      if (dto.name !== undefined) {
        const name = this.cleanName(dto.name, 'Option group name');
        this.assertUniqueName(siblings.map((o) => o.name), name, 'OPTION_NAME_TAKEN', 'This product already has an option group with that name.');
        option.name = name;
      }
      if (dto.nameAr !== undefined) option.nameAr = dto.nameAr.trim() || null;

      const shape = this.normalizeShape({
        isRequired: dto.isRequired ?? option.isRequired,
        allowsMultiple: dto.allowsMultiple ?? option.allowsMultiple,
        minSelections: dto.minSelections ?? option.minSelections,
        maxSelections: dto.maxSelections === undefined ? option.maxSelections : dto.maxSelections,
      });
      this.assertShapeFitsValueCount(shape, option.values.length);
      Object.assign(option, shape);
      await manager.save(ProductOption, option);
      return (await this.loadGroup(manager, option.id))!;
    });
  }

  async deleteOption(optionId: string, authorize: ProductAuthorizer): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const option = await this.requireOption(optionId, manager);
      await this.requireProduct(option.productId, authorize, manager, true);
      await this.detachFromCarts(manager, option.values.map((v) => v.id));
      await manager.delete(ProductOption, { id: option.id }); // its values go with it (ON DELETE CASCADE)
    });
  }

  // ---- values ------------------------------------------------------------------------------------------------------------------

  async addValue(optionId: string, dto: ProductOptionValueDto, authorize: ProductAuthorizer): Promise<ProductOption> {
    return this.dataSource.transaction(async (manager) => {
      const option = await this.requireOption(optionId, manager);
      const product = await this.requireProduct(option.productId, authorize, manager, true);
      if (option.values.length >= MAX_VALUES_PER_OPTION_GROUP) {
        throw this.bad('TOO_MANY_OPTION_VALUES', `An option group can have at most ${MAX_VALUES_PER_OPTION_GROUP} values.`);
      }
      this.assertValuesValid([dto], Number(product.priceMinor), option.values.map((v) => v.name));
      await manager.save(
        ProductOptionValue,
        manager.create(ProductOptionValue, { optionId: option.id, name: dto.name.trim(), nameAr: dto.nameAr?.trim() || null, priceDeltaMinor: dto.priceDeltaMinor ?? 0 }),
      );
      return (await this.loadGroup(manager, option.id))!;
    });
  }

  async updateValue(valueId: string, dto: UpdateProductOptionValueDto, authorize: ProductAuthorizer): Promise<ProductOption> {
    return this.dataSource.transaction(async (manager) => {
      const value = await this.requireValue(valueId, manager);
      const option = await this.requireOption(value.optionId, manager);
      const product = await this.requireProduct(option.productId, authorize, manager, true);
      const others = option.values.filter((v) => v.id !== value.id).map((v) => v.name);
      const next = {
        name: dto.name !== undefined ? dto.name : value.name,
        nameAr: dto.nameAr !== undefined ? dto.nameAr : value.nameAr ?? undefined,
        priceDeltaMinor: dto.priceDeltaMinor !== undefined ? dto.priceDeltaMinor : Number(value.priceDeltaMinor),
      };
      this.assertValuesValid([next], Number(product.priceMinor), others);
      value.name = next.name.trim();
      value.nameAr = next.nameAr?.trim() || null;
      value.priceDeltaMinor = next.priceDeltaMinor;
      await manager.save(ProductOptionValue, value);
      return (await this.loadGroup(manager, option.id))!;
    });
  }

  async deleteValue(valueId: string, authorize: ProductAuthorizer): Promise<ProductOption> {
    return this.dataSource.transaction(async (manager) => {
      const value = await this.requireValue(valueId, manager);
      const option = await this.requireOption(value.optionId, manager);
      await this.requireProduct(option.productId, authorize, manager, true);
      const remaining = option.values.length - 1;
      const { min } = { min: Math.max(option.minSelections, option.isRequired ? 1 : 0) };
      if (remaining < min) {
        throw new ConflictException({
          message: 'This group requires a choice, so it must keep enough values. Edit the group first, or delete the whole group.',
          details: { code: 'OPTION_GROUP_WOULD_BE_EMPTY', remaining, required: min },
        });
      }
      await this.detachFromCarts(manager, [value.id]);
      await manager.delete(ProductOptionValue, { id: value.id });
      return (await this.loadGroup(manager, option.id))!;
    });
  }

  // ---- internals ---------------------------------------------------------------------------------------------------------------

  private async requireProduct(productId: string, authorize: ProductAuthorizer, manager: EntityManager = this.dataSource.manager, lock = false): Promise<Product> {
    if (!/^[0-9a-f-]{36}$/i.test(productId)) throw new NotFoundException('Product not found.');
    const product = await manager.findOne(Product, { where: { id: productId }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!product) throw new NotFoundException('Product not found.');
    await authorize(product); // throws NotFound for someone else's product
    return product;
  }

  private async requireOption(optionId: string, manager: EntityManager): Promise<ProductOption> {
    if (!/^[0-9a-f-]{36}$/i.test(optionId)) throw new NotFoundException('Option group not found.');
    const option = await this.loadGroup(manager, optionId);
    if (!option) throw new NotFoundException('Option group not found.');
    return option;
  }

  private async requireValue(valueId: string, manager: EntityManager): Promise<ProductOptionValue> {
    if (!/^[0-9a-f-]{36}$/i.test(valueId)) throw new NotFoundException('Option value not found.');
    const value = await manager.findOne(ProductOptionValue, { where: { id: valueId } });
    if (!value) throw new NotFoundException('Option value not found.');
    return value;
  }

  private loadGroups(manager: EntityManager, productId: string): Promise<ProductOption[]> {
    return manager.find(ProductOption, { where: { productId }, relations: { values: true }, order: { createdAt: 'ASC', values: { createdAt: 'ASC' } } });
  }

  private loadGroup(manager: EntityManager, optionId: string): Promise<ProductOption | null> {
    return manager.findOne(ProductOption, { where: { id: optionId }, relations: { values: true }, order: { values: { createdAt: 'ASC' } } });
  }

  /** Removes the given values from every cart that holds them; the cart item stays and is re-validated at checkout. */
  private async detachFromCarts(manager: EntityManager, valueIds: string[]): Promise<void> {
    if (valueIds.length === 0) return;
    await manager.query('DELETE FROM "cart_item_option_values" WHERE "product_option_value_id" = ANY($1::uuid[])', [valueIds]);
  }

  private bad(code: string, message: string, extra: Record<string, unknown> = {}): BadRequestException {
    return new BadRequestException({ message, details: { code, ...extra } });
  }

  private cleanName(raw: string, label: string): string {
    const name = (raw ?? '').trim();
    if (!name) throw this.bad('OPTION_NAME_REQUIRED', `${label} is required.`);
    return name;
  }

  private assertUniqueName(existing: string[], name: string, code: string, message: string): void {
    if (existing.some((n) => n.trim().toLowerCase() === name.toLowerCase())) throw new ConflictException({ message, details: { code } });
  }

  /** Resolves the flags/limits into a coherent stored shape (single-choice carries no maximum; required means min ≥ 1). */
  private normalizeShape(input: GroupShape): GroupShape {
    let { isRequired, allowsMultiple, minSelections, maxSelections } = input;
    if (!allowsMultiple) {
      if (minSelections > 1) throw this.bad('INVALID_OPTION_LIMITS', 'A single-choice group cannot require more than one selection.');
      if (maxSelections !== null && maxSelections !== 1) throw this.bad('INVALID_OPTION_LIMITS', 'A single-choice group allows exactly one selection; remove the maximum or make it multiple-choice.');
      maxSelections = null;
    }
    if (isRequired && minSelections < 1) minSelections = 1;
    if (minSelections >= 1) isRequired = true;
    if (maxSelections !== null && maxSelections < Math.max(minSelections, 1)) {
      throw this.bad('INVALID_OPTION_LIMITS', 'The maximum selections cannot be lower than the minimum.');
    }
    return { isRequired, allowsMultiple, minSelections, maxSelections };
  }

  private assertShapeFitsValueCount(shape: GroupShape, valueCount: number): void {
    const min = Math.max(shape.minSelections, shape.isRequired ? 1 : 0);
    if (min > valueCount) {
      throw this.bad('INVALID_OPTION_LIMITS', `This group requires ${min} selection(s) but has only ${valueCount} value(s).`, { required: min, values: valueCount });
    }
  }

  private assertValuesValid(values: Array<{ name: string; priceDeltaMinor?: number }>, basePriceMinor: number, alreadyUsedNames: string[] = []): void {
    const used = alreadyUsedNames.map((n) => n.trim().toLowerCase());
    for (const v of values) {
      const name = this.cleanName(v.name, 'Option value name').toLowerCase();
      if (used.includes(name)) throw new ConflictException({ message: 'This group already has a value with that name.', details: { code: 'OPTION_VALUE_NAME_TAKEN' } });
      used.push(name);
      const delta = v.priceDeltaMinor ?? 0;
      if (!Number.isInteger(delta)) throw this.bad('INVALID_OPTION_PRICE', 'A modifier price must be a whole number of minor units.');
      if (basePriceMinor + delta < 0) throw this.bad('INVALID_OPTION_PRICE', 'A negative modifier cannot take the product price below zero.', { basePriceMinor, priceDeltaMinor: delta });
    }
  }
}
