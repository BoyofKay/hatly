import { resolveMapsLink } from '../../../common/geo/maps-link';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceArea } from '../../service-areas/entities/service-area.entity';
import { ServiceAreaResolverService } from '../../service-areas/service-area-resolver.service';
import { boxAround, nominatimSearch, openGeocoderEnabled } from '../../location/open-geocoder';
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsString, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { MAP_PROVIDER, MapProvider } from '../../location/map-provider.interface';
import { RateLimitPolicies, Throttled } from '../../../common/throttling/rate-limit-policies';

class ReverseGeocodeQuery {
  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @Type(() => Number)
  @IsLongitude()
  longitude: number;
}

class MapsLinkQuery {
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  url: string;
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
  constructor(
    @Inject(MAP_PROVIDER) private readonly mapProvider: MapProvider,
    @InjectRepository(ServiceArea) private readonly serviceAreas: Repository<ServiceArea>,
    private readonly serviceAreaResolver: ServiceAreaResolverService,
  ) {}

  /** The active service areas (centre + radius), so the app's map can show where Hatly works (owner UAT 2026-11-27). */
  @Get('service-areas')
  async areas() {
    const rows = await this.serviceAreas.find({ where: { isActive: true } });
    return { data: rows.map((a) => ({ id: a.id, name: a.name, nameAr: a.nameAr ?? null, centerLatitude: Number(a.centerLatitude), centerLongitude: Number(a.centerLongitude), radiusMeters: Number(a.radiusMeters) })) };
  }

  /** Whether a point is inside an active service area — the app checks a chosen point before using it. */
  @Throttled(RateLimitPolicies.geoLookup)
  @Get('serviceable')
  async serviceable(@Query() query: ReverseGeocodeQuery) {
    const area = await this.serviceAreaResolver.resolveForPoint(query.latitude, query.longitude);
    return { data: { serviceable: Boolean(area), serviceAreaName: area?.name ?? null } };
  }

  @Throttled(RateLimitPolicies.geoLookup)
  @Get('reverse')
  async reverse(@Query() query: ReverseGeocodeQuery) {
    try {
      const formattedAddress = await this.mapProvider.reverseGeocode({ latitude: query.latitude, longitude: query.longitude });
      return { data: { formattedAddress } };
    } catch {
      return { data: { formattedAddress: null } };
    }
  }

  /**
   * Owner request 2026-11-27: a point for Hatly / Wasaly (or an address) from a link the customer copied in Google Maps or Apple Maps —
   * long links are read directly, short share links are opened (Google / Apple map hosts only). Works while the in-app map is off.
   */
  @Throttled(RateLimitPolicies.geoLookup)
  @Get('maps-link')
  async mapsLink(@Query() query: MapsLinkQuery) {
    const point = await resolveMapsLink(query.url).catch(() => null);
    return { data: point ? { latitude: point.lat, longitude: point.lng } : null };
  }

  @Throttled(RateLimitPolicies.geoLookup)
  @Get('search')
  async search(@Query() query: SearchQuery) {
    try {
      const point = await this.mapProvider.geocode(query.q);
      if (point) return { data: { latitude: point.latitude, longitude: point.longitude } };
    } catch {
      /* the configured provider is off or failed: try the open fallback */
    }
    if (!openGeocoderEnabled()) return { data: null };
    try {
      const box = boxAround((await this.serviceAreas.find({ where: { isActive: true } })).map((a) => ({ centerLatitude: Number(a.centerLatitude), centerLongitude: Number(a.centerLongitude), radiusMeters: Number(a.radiusMeters) })));
      return { data: await nominatimSearch(query.q, box) };
    } catch {
      return { data: null };
    }
  }
}
