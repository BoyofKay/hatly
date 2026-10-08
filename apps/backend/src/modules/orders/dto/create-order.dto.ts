import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { ElectronicPaymentMethod } from '../../payments/electronic-payment-method.enum';
import { ORDER_PAYMENT_METHODS, OrderPaymentMethod } from '../order-payment-method';

/**
 * The delivery address as the customer confirmed it at checkout. The coordinates (optional, PD-009) are the authoritative location; the
 * structured fields are what the customer typed; `formattedAddress` is only the map provider's suggestion. The whole thing is
 * frozen into `Order.deliveryAddressSnapshot` — there is no live address row an order could later depend on.
 */
export class DeliveryAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsString()
  @MaxLength(255)
  line1: string;

  /** PD-009: optional map pin (both or neither). Without one, `deliveryZoneId` locates the address. */
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  /** PD-009: the Delivery Zone the customer selected. Names/fee are always resolved server-side — never sent by the client. */
  @IsOptional()
  @IsUUID()
  deliveryZoneId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  governorate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  buildingNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  floor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  apartment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  formattedAddress?: string;
}

/**
 * Nothing in here is an authoritative amount. The subtotal, discount, delivery fee, wallet deduction and total are all decided
 * by the server; the client only says WHAT it chose (and, optionally, WHICH quote it confirmed).
 */
export class CreateOrderDto {
  /** A new / unsaved address. Exactly one of `deliveryAddress` / `addressId` for a delivery order; neither for pickup. */
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress?: DeliveryAddressDto;

  /** One of THIS customer's saved addresses (ownership is checked server-side). */
  @IsOptional()
  @IsUUID()
  addressId?: string;

  /**
   * COD (cash to the driver) · PAY_AT_DELIVERY (electronic, when the driver arrives) · MANUAL_TRANSFER (electronic prepayment,
   * verified by an admin) · WALLET (the wallet covers the whole order) · ONLINE (legacy, always refused). See order-payment-method.ts.
   */
  @IsIn(ORDER_PAYMENT_METHODS)
  paymentMethod: OrderPaymentMethod;

  /** Required for MANUAL_TRANSFER and PAY_AT_DELIVERY; refused otherwise. Stored on the order. */
  @IsOptional()
  @IsEnum(ElectronicPaymentMethod)
  electronicPaymentMethod?: ElectronicPaymentMethod;

  /** Use the Hatly wallet for (part of) the order. The server decides the real amount. */
  @IsOptional()
  @IsBoolean()
  useWallet?: boolean;

  /** An optional CAP on the wallet amount. It can only lower what the server would apply, never raise it. */
  @IsOptional()
  @IsInt()
  @Min(1)
  walletAmountMinor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/)
  couponCode?: string;

  /** The quote the customer confirmed (from POST /checkout/quote). If it no longer matches, the order is refused with QUOTE_STALE. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  quoteToken?: string;
}
