import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminPermission } from './entities/admin-permission.entity';
import { PermissionsService } from './permissions.service';
import { PermissionsGuard } from './permissions.guard';
import {
  AdminPermissionsController,
  AdminUsersController,
  AdminPermissionCatalogController,
  AdminMePermissionsController,
} from './admin-permissions.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([AdminPermission]), UsersModule],
  controllers: [AdminPermissionsController, AdminUsersController, AdminPermissionCatalogController, AdminMePermissionsController],
  providers: [PermissionsService, PermissionsGuard],
  exports: [PermissionsService, PermissionsGuard],
})
export class PermissionsModule {}
