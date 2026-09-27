import { IsLatitude, IsLongitude } from 'class-validator';

export class QuoteDeliveryFeeDto {
  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}
