import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Favorite } from './entities/favorite.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { FavoritesService } from './favorites.service';
import { FavoritesController } from './favorites.controller';

/**
 * Entities-only import of Vendor (same one-directional "needs
 * entities, not services" shape already established by RatingsModule
 * — see that module's own comment) — no dependency on VendorsModule's
 * services, no forwardRef needed.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Favorite, Vendor, VendorBranch])],
  controllers: [FavoritesController],
  providers: [FavoritesService],
})
export class FavoritesModule {}
