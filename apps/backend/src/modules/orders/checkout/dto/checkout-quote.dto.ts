import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { ElectronicPaymentMethod } from '../../../payments/electronic-payment-method.enum';
import { ORDER_PAYMENT_METHODS, OrderPaymentMethod } from '../../order-payment-method';
import { DeliveryAddressDto } from '../../dto/create-order.dto';

/**
 * What the customer has chosen so far. Every field is optional — a quote can be asked for before anything is chosen (it then
 * reports what is still missing). None of it is an authoritative amount: the server prices everything.
 */
export class CheckoutQuoteDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress?: DeliveryAddressDto;

  @IsOptional()
  @IsUUID()
  addressId?: string;

  @IsOptional()
  @IsIn(ORDER_PAYMENT_METHODS)
  paymentMethod?: OrderPaymentMethod;

  @IsOptional()
  @IsEnum(ElectronicPaymentMethod)
  electronicPaymentMethod?: ElectronicPaymentMethod;

  @IsOptional()
  @IsBoolean()
  useWallet?: boolean;

  /** An optional cap on the wallet amount; the server decides the real amount. */
  @IsOptional()
  @IsInt()
  @Min(1)
  walletAmountMinor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/)
  couponCode?: string;
}
