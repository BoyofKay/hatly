import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { AdminCustomersController } from './admin-customers.controller';
import { AdminCustomersService } from './admin-customers.service';
import { AddressesModule } from '../addresses/addresses.module';
import { WalletModule } from '../wallet/wallet.module';
import { OrdersModule } from '../orders/orders.module';
import { PermissionsModule } from '../permissions/permissions.module';

/**
 * M3c (Launch-Readiness Gap Audit, G-10) — its own small module, not
 * folded into `UsersModule` (kept minimal by design) or `OrdersModule`
 * (already large, with several `forwardRef` mutual dependencies —
 * isolating this new import graph here avoids adding any risk to
 * that). Reuses `AddressesService`/`WalletService`/`AdminOrdersService`
 * from their own existing modules rather than duplicating any query.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), AddressesModule, WalletModule, OrdersModule, PermissionsModule],
  controllers: [AdminCustomersController],
  providers: [AdminCustomersService],
})
export class AdminCustomersModule {}
