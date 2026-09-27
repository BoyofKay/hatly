import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsString, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { MAP_PROVIDER, MapProvider } from '../../location/map-provider.interface';

class ReverseGeocodeQuery {
  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @Type(() => Number)
  @IsLongitude()
  longitude: number;
}

class SearchQuery {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  q: string;
}

/**
 * ASSISTIVE map lookups for the address picker, proxied through the server so the map provider key never ships in the app for
 * these calls. The result is only a SUGGESTION the customer can edit — the pin's coordinates stay the authoritative location.
 * A provider failure is reported as "no suggestion" (the customer can still type the address); it never blocks checkout.
 */
@ApiTags('geo')
@Controller('geo')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class GeoController {
  constructor(@Inject(MAP_PROVIDER) private readonly mapProvider: MapProvider) {}

  @Get('reverse')
  async reverse(@Query() query: ReverseGeocodeQuery) {
    try {
      const formattedAddress = await this.mapProvider.reverseGeocode({ latitude: query.latitude, longitude: query.longitude });
      return { data: { formattedAddress } };
    } catch {
      return { data: { formattedAddress: null } };
    }
  }

  @Get('search')
  async search(@Query() query: SearchQuery) {
    try {
      const point = await this.mapProvider.geocode(query.q);
      return { data: point ? { latitude: point.latitude, longitude: point.longitude } : null };
    } catch {
      return { data: null };
    }
  }
}
