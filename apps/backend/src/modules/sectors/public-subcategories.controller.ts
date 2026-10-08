import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SubcategoriesService } from './subcategories.service';

/**
 * CONFIRMED: the authoritative source for a sector's subcategory chip/
 * card row — a real backend model, not a hardcoded Flutter list, same
 * discipline as `PublicSectorsController`. Public — browsing shouldn't
 * require login (same established convention as every other
 * marketplace-browsing endpoint in this codebase).
 */
@ApiTags('sectors')
@Controller('sectors/:sectorId/subcategories')
export class PublicSubcategoriesController {
  constructor(private readonly subcategoriesService: SubcategoriesService) {}

  @Public()
  @Get()
  async list(@Param('sectorId') sectorId: string) {
    const subcategories = await this.subcategoriesService.listActiveForSector(sectorId);
    return { data: subcategories };
  }
}
