import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { HomeBannersService } from './home-banners.service';

/**
 * The customer Home carousel's banners. Public, like `GET /sectors` (browsing needs no account), and limited to what is eligible to be
 * shown right now — see HomeBannersService.listPublic. Exposes nothing administrative.
 */
@ApiTags('home-banners')
@Controller('home-banners')
export class PublicHomeBannersController {
  constructor(private readonly banners: HomeBannersService) {}

  @Public()
  @Get()
  async list() {
    return { data: await this.banners.listPublic() };
  }
}
