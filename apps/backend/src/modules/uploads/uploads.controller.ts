import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UploadsService } from './uploads.service';
import { CreateUploadDto } from './dto/create-upload.dto';

/**
 * Open to any authenticated role (no @Roles/@RequiresPermission) —
 * a customer uploading a prescription photo for an ad-hoc "Hatly
 * Service" item is the primary use case, and there's no stated reason
 * to restrict who may upload an image in general.
 */
@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post()
  async create(@Body() dto: CreateUploadDto, @CurrentUser() user: AuthenticatedUser) {
    const upload = await this.uploadsService.upload(dto.base64Content, dto.filename, user.id);
    return { data: { id: upload.id, url: upload.url } };
  }
}
