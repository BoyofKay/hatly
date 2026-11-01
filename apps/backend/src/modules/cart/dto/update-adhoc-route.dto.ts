import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional, IsString, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

/** One route endpoint the customer chose: a point and a short display label (e.g. "Current location", a saved address, a map pin). */
export class RouteEndpointDto {
  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

/**
 * PD-012. Each end is independent: an object sets it, `null` clears it back to the service's configured default, and leaving the field
 * out leaves it unchanged.
 */
export class UpdateAdHocRouteDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @ValidateNested()
  @Type(() => RouteEndpointDto)
  origin?: RouteEndpointDto | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @ValidateNested()
  @Type(() => RouteEndpointDto)
  destination?: RouteEndpointDto | null;
}
