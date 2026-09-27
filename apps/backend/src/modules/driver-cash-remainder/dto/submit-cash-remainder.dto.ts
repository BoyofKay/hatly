import { IsInt, Min } from 'class-validator';

/** No customerId field — CONFIRMED, identity always comes from the Delivery/Order via the authenticated Driver, never the client. */
export class SubmitCashRemainderDto {
  @IsInt()
  @Min(1)
  cashReceivedMinor: number;
}
