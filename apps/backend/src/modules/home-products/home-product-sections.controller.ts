import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { HomeProductSectionsQueryDto } from './home-product-sections.dto';
import { HomeProductSectionsService } from './home-product-sections.service';

/**
 * `GET /home/product-sections` — public (browsing Home needs no account) and identical for every caller: nothing in it depends on the
 * customer, so the shared cache keys carry only the delivery-zone scope. `X-Home-Cache: HIT | MISS | BYPASS` reports where it came from
 * (BYPASS = Redis unavailable, answered from the database).
 */
@ApiTags('home')
@Controller('home')
export class HomeProductSectionsController {
  constructor(private readonly service: HomeProductSectionsService) {}

  @Public()
  @Get('product-sections')
  async productSections(@Query() query: HomeProductSectionsQueryDto, @Res({ passthrough: true }) res: Response) {
    const { response, cache } = await this.service.getSections({ sections: query.sections, deliveryZoneId: query.deliveryZoneId });
    res.setHeader('X-Home-Cache', cache);
    return { data: response };
  }
}
