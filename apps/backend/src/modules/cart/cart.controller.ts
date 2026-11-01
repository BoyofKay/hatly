import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CartService } from './cart.service';
import { CartCompatibilityService } from './cart-compatibility.service';
import { CheckAddItemDto } from './dto/check-add-item.dto';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateAdHocRouteDto } from './dto/update-adhoc-route.dto';
import { AddAdHocCartItemDto } from './dto/add-adhoc-cart-item.dto';
import { AddVendorCustomItemDto } from './dto/add-vendor-custom-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { SetFulfillmentTypeDto } from './dto/set-fulfillment-type.dto';
import { QuoteDeliveryFeeDto } from './dto/quote-delivery-fee.dto';
import { RateLimitPolicies, Throttled } from '../../common/throttling/rate-limit-policies';

/**
 * Every endpoint here acts on "the current customer's cart" — there is
 * no cartId in any route. This is deliberate: rule #1 ("a cart belongs
 * to one customer") is enforced by construction, not by an ownership
 * check the client could get wrong — a customer can never even
 * construct a request that names someone else's cart.
 */
@ApiTags('cart')
@Controller('cart')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class CartController {
  constructor(private readonly cartService: CartService, private readonly compatibility: CartCompatibilityService) {}

  @Get()
  async getCart(@CurrentUser() user: AuthenticatedUser) {
    const cart = await this.cartService.getCartView(user.id);
    return { data: cart };
  }

  /** Would this product fit in the current cart? Read-only; the answer carries the server's own reason and the way out (see CartCompatibilityService). */
  @Post('items/check')
  @HttpCode(200)
  async checkAddItem(@CurrentUser() user: AuthenticatedUser, @Body() dto: CheckAddItemDto) {
    return { data: await this.compatibility.checkAdd(user.id, dto.productId) };
  }

  @Post('items')
  async addItem(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddCartItemDto) {
    const cart = await this.cartService.addItem(user.id, dto);
    return { data: cart };
  }

  @Throttled(RateLimitPolicies.customRequest)
  @Post('adhoc-items')
  async addAdHocItem(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddAdHocCartItemDto) {
    const cart = await this.cartService.addAdHocItem(user.id, dto);
    return { data: cart };
  }

  /** PD-012: change the Hatly / Wasally route origin and/or destination (each independently; `null` = back to the configured default). */
  @Patch('adhoc-route')
  async updateAdHocRoute(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAdHocRouteDto) {
    const cart = await this.cartService.updateAdHocRoute(user.id, dto);
    return { data: cart };
  }

  /**
   * Vendor/Pharmacy Custom Item — always attaches to an EXISTING
   * CATALOG group (never creates/uses an AD_HOC_SERVICE group). Kept
   * as its own route/method, deliberately not merged into
   * `adhoc-items`, since the two have different targeting rules
   * (this one requires an existing CATALOG group; that one can start
   * a new AD_HOC_SERVICE group).
   */
  @Throttled(RateLimitPolicies.customRequest)
  @Post('vendor-custom-items')
  async addVendorCustomItem(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddVendorCustomItemDto) {
    const cart = await this.cartService.addVendorCustomItem(user.id, dto);
    return { data: cart };
  }

  @Patch('fulfillment-type')
  async setFulfillmentType(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetFulfillmentTypeDto) {
    const cart = await this.cartService.setFulfillmentType(user.id, dto.fulfillmentType);
    return { data: cart };
  }

  @Throttled(RateLimitPolicies.deliveryFeeQuote)
  @Post('delivery-fee-quote')
  async quoteDeliveryFee(@CurrentUser() user: AuthenticatedUser, @Body() dto: QuoteDeliveryFeeDto) {
    const quote = await this.cartService.quoteDeliveryFee(user.id, {
      latitude: dto.latitude,
      longitude: dto.longitude,
    });
    return { data: quote };
  }

  @Patch('items/:itemId')
  async updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    // PHASE G addition (Weighted Products). Branches on which field
    // the request actually supplied — CartService itself validates it
    // against the item's real pricingUnit (a quantity update for a
    // WEIGHT item, or vice versa, is rejected there, not here).
    if (dto.requestedWeightGrams !== undefined) {
      const cart = await this.cartService.updateItemWeight(user.id, itemId, dto.requestedWeightGrams);
      return { data: cart };
    }
    if (dto.quantity === undefined) {
      throw new BadRequestException('Either quantity or requestedWeightGrams is required.');
    }
    const cart = await this.cartService.updateItemQuantity(user.id, itemId, dto.quantity);
    return { data: cart };
  }

  @Delete('items/:itemId')
  async removeItem(@CurrentUser() user: AuthenticatedUser, @Param('itemId') itemId: string) {
    const cart = await this.cartService.removeItem(user.id, itemId);
    return { data: cart };
  }

  @Delete()
  async clearCart(@CurrentUser() user: AuthenticatedUser) {
    const cart = await this.cartService.clearCart(user.id);
    return { data: cart };
  }
}
