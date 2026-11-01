import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BusinessConfigService } from '../business-config/business-config.service';
import { Product } from '../products/entities/product.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { Cart, CartStatus } from './entities/cart.entity';
import { CartVendorGroup } from './entities/cart-vendor-group.entity';
import { CartGroupType } from './cart-group-type.enum';
import { FulfillmentType } from './fulfillment-type.enum';
import { CartService } from './cart.service';

/** What the customer can do about an incompatibility — chosen by the server so the app never re-implements the rules. */
export type CompatibilityResolution = 'SWITCH_TO_DELIVERY' | 'START_NEW_CART' | null;

export interface CompatibilityResult {
  compatible: boolean;
  /** The same business codes `POST /cart/items` would answer with (plus `MULTI_VENDOR_DISABLED`, which only checkout enforced before). */
  code: string | null;
  message: string | null;
  resolution: CompatibilityResolution;
  /** The vendor group already in the cart for this product's branch — adding to it can never be incompatible. */
  alreadyInCart: boolean;
}

const OK: CompatibilityResult = { compatible: true, code: null, message: null, resolution: null, alreadyInCart: false };
const no = (code: string, message: string, resolution: CompatibilityResolution = null): CompatibilityResult => ({ compatible: false, code, message, resolution, alreadyInCart: false });

/**
 * "Would this product fit in my cart?" answered BEFORE the customer adds it, with the very same rules `CartService.addItem` and checkout enforce:
 * product and branch availability, a catalog cart never mixing with Hatly Service, pickup = one registered vendor whose branch offers pickup, the
 * vendor-group cap, and — the one rule that used to bite only at checkout — whether multi-vendor ordering is switched on. Nothing is written.
 */
@Injectable()
export class CartCompatibilityService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cartService: CartService,
    private readonly businessConfig: BusinessConfigService,
  ) {}

  async checkAdd(customerId: string, productId: string): Promise<CompatibilityResult> {
    const product = await this.dataSource.getRepository(Product).findOne({ where: { id: productId }, relations: { vendorBranch: { vendor: true } } });
    if (!product || product.deletedAt) throw new NotFoundException('Product not found.');
    if (!product.isAvailable) return no('PRODUCT_UNAVAILABLE', 'This product is currently unavailable.');
    if (!product.vendorBranch || !product.vendorBranch.isActive || !product.vendorBranch.vendor?.isActive) return no('BRANCH_UNAVAILABLE', 'This vendor branch is currently unavailable.');

    const cart = await this.dataSource.getRepository(Cart).findOne({ where: { customerId, status: CartStatus.ACTIVE } });
    if (!cart) return OK;
    const groups = await this.dataSource.getRepository(CartVendorGroup).find({ where: { cartId: cart.id } });
    if (groups.some((g) => g.groupType === CartGroupType.CATALOG && g.vendorBranchId === product.vendorBranchId)) return { ...OK, alreadyInCart: true };

    try {
      this.cartService.assertNewGroupAllowed(cart, groups, CartGroupType.CATALOG);
    } catch (err) {
      if (err instanceof ConflictException) {
        const body = err.getResponse() as { message?: string; details?: { code?: string } };
        const code = body.details?.code ?? 'CART_CONFLICT';
        const resolution: CompatibilityResolution = code.startsWith('PICKUP_') ? 'SWITCH_TO_DELIVERY' : 'START_NEW_CART';
        return no(code, body.message ?? 'This item cannot be added to your cart.', resolution);
      }
      throw err;
    }
    if (groups.length >= 1 && !(await this.businessConfig.isMultiVendorOrdersEnabled())) {
      return no('MULTI_VENDOR_DISABLED', 'Orders from more than one vendor are not available right now. Finish or clear your cart to order from another vendor.', 'START_NEW_CART');
    }
    if (cart.fulfillmentType === FulfillmentType.PICKUP && groups.length === 0) {
      const branch = await this.dataSource.getRepository(VendorBranch).findOne({ where: { id: product.vendorBranchId } });
      if (!branch?.pickupEnabled) return no('BRANCH_PICKUP_DISABLED', 'This vendor does not offer pickup.', 'SWITCH_TO_DELIVERY');
    }
    return OK;
  }
}
