import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { VendorRatingService } from './vendor-rating.service';
import { DriverRatingService } from './driver-rating.service';
import { ProductRatingService } from './product-rating.service';
import { CreateVendorRatingDto } from './dto/create-vendor-rating.dto';
import { CreateDriverRatingDto } from './dto/create-driver-rating.dto';
import { CreateProductRatingDto } from './dto/create-product-rating.dto';
import { RateLimitPolicies, Throttled } from '../../common/throttling/rate-limit-policies';

/**
 * CONFIRMED business decision: no update/delete endpoint exists here,
 * or anywhere, for a rating — a rating is historical the moment it's
 * created. No Admin-facing endpoint exists in this module either
 * (moderation was explicitly out of scope for this chunk).
 */
@ApiTags('ratings')
@Controller('ratings')
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER)
export class RatingsController {
  constructor(
    private readonly vendorRatingService: VendorRatingService,
    private readonly driverRatingService: DriverRatingService,
    private readonly productRatingService: ProductRatingService,
  ) {}

  @Throttled(RateLimitPolicies.ratingSubmit)
  @Post('vendor')
  async rateVendor(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVendorRatingDto) {
    const rating = await this.vendorRatingService.create({
      customerId: user.id,
      orderVendorSegmentId: dto.orderVendorSegmentId,
      stars: dto.stars,
      comment: dto.comment,
    });
    return { data: rating };
  }

  @Throttled(RateLimitPolicies.ratingSubmit)
  @Post('driver')
  async rateDriver(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDriverRatingDto) {
    const rating = await this.driverRatingService.create({
      customerId: user.id,
      deliveryId: dto.deliveryId,
      stars: dto.stars,
      comment: dto.comment,
    });
    return { data: rating };
  }

  @Throttled(RateLimitPolicies.ratingSubmit)
  @Post('product')
  async rateProduct(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductRatingDto) {
    const rating = await this.productRatingService.create({
      customerId: user.id,
      orderItemId: dto.orderItemId,
      stars: dto.stars,
      comment: dto.comment,
    });
    return { data: rating };
  }
}
