import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SectorsService } from './sectors.service';

/**
 * CONFIRMED (decision 12): the authoritative source for the Home
 * marketplace sector list — replaces Flutter's `category_fixture.dart`
 * (explicitly commented "NOT A BUSINESS DECISION" in that file).
 * Public — matches ProductsController's own established
 * "browsing shouldn't require login" convention.
 */
@ApiTags('sectors')
@Controller('sectors')
export class PublicSectorsController {
  constructor(private readonly sectorsService: SectorsService) {}

  @Public()
  @Get()
  async list() {
    const sectors = await this.sectorsService.listActiveForCustomers();
    return { data: sectors };
  }
}
