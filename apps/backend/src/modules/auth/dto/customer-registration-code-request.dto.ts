import { IsPhoneNumber } from 'class-validator';

/** Asks for the one-time code that must accompany a customer registration while `CUSTOMER_OTP_ENABLED` is on. */
export class CustomerRegistrationCodeRequestDto {
  @IsPhoneNumber('EG')
  phone: string;
}
