import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ApiTags } from '@nestjs/swagger';
import { RateLimitPolicies, Throttled } from '../../common/throttling/rate-limit-policies';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { UploadsService } from './uploads.service';
import { CreateAudioUploadDto, CreateUploadDto } from './dto/create-upload.dto';

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

  // Image uploads are the heaviest size-bounded write: cap per-client frequency well below the per-route default.
  @Throttled(RateLimitPolicies.mediaUpload)
  @Post()
  async create(@Body() dto: CreateUploadDto, @CurrentUser() user: AuthenticatedUser) {
    const upload = await this.uploadsService.upload(dto.base64Content, dto.filename, user.id);
    return { data: { id: upload.id, url: upload.url } };
  }

  /** Voice notes for Hatly / Wasaly requests (owner decision 2026-11-27): up to 5 minutes, audio formats checked by their bytes. */
  // Customers only: voice notes are recorded by the customer; Operations write their driver note as text.
  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER)
  @Throttled(RateLimitPolicies.mediaUpload)
  @Post('audio')
  async createAudio(@Body() dto: CreateAudioUploadDto, @CurrentUser() user: AuthenticatedUser) {
    const upload = await this.uploadsService.uploadAudio(dto.base64Content, user.id);
    return { data: { id: upload.id, url: upload.url } };
  }
}
