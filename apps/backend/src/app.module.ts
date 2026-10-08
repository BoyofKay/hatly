import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './common/redis/redis.constants';
import { HatlyThrottlerGuard } from './common/throttling/hatly-throttler.guard';
import { RedisThrottlerStorage } from './common/throttling/redis-throttler.storage';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { limitConcurrentTransactions, safeTransactionLimit, TransactionLimiter } from './database/transaction-limiter';
import configuration from './config/configuration';
import { validateEnvironment } from './config/env.validation';
import { RequestContextService } from './common/request-context/request-context.service';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './modules/permissions/permissions.guard';
import { RedisModule } from './common/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { RequestContextModule } from './common/request-context/request-context.module';
import { RequestContextMiddleware } from './common/request-context/request-context.middleware';
import { RejectNulBytesMiddleware } from './common/middleware/reject-nul-bytes.middleware';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { BusinessConfigModule } from './modules/business-config/business-config.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { ProductsModule } from './modules/products/products.module';
import { CartModule } from './modules/cart/cart.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { OrdersModule } from './modules/orders/orders.module';
import { FailedDeliveryResolutionModule } from './modules/failed-delivery-resolution/failed-delivery-resolution.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { LocationModule } from './modules/location/location.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { OffersModule } from './modules/offers/offers.module';
import { SectorsModule } from './modules/sectors/sectors.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { ServiceAreasModule } from './modules/service-areas/service-areas.module';
import { DeliveryZonesModule } from './modules/delivery-zones/delivery-zones.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { DriverCashRemainderModule } from './modules/driver-cash-remainder/driver-cash-remainder.module';
import { AdminCustomersModule } from './modules/admin-customers/admin-customers.module';

import { User } from './modules/users/entities/user.entity';
import { Vendor } from './modules/vendors/entities/vendor.entity';
import { VendorBranch } from './modules/vendors/entities/vendor-branch.entity';
import { VendorStaff } from './modules/vendors/entities/vendor-staff.entity';
import { ProductCategory } from './modules/products/entities/product-category.entity';
import { Product } from './modules/products/entities/product.entity';
import { ProductOption } from './modules/products/entities/product-option.entity';
import { ProductOptionValue } from './modules/products/entities/product-option-value.entity';
import { Cart } from './modules/cart/entities/cart.entity';
import { CartVendorGroup } from './modules/cart/entities/cart-vendor-group.entity';
import { CartItem } from './modules/cart/entities/cart-item.entity';
import { CartItemOptionValue } from './modules/cart/entities/cart-item-option-value.entity';
import { Order } from './modules/orders/entities/order.entity';
import { OrderVendorSegment } from './modules/orders/entities/order-vendor-segment.entity';
import { OrderItem } from './modules/orders/entities/order-item.entity';
import { AdHocPurchaseRecord } from './modules/orders/entities/ad-hoc-purchase-record.entity';
import { OrderItemWeightRecord } from './modules/orders/entities/order-item-weight-record.entity';
import { Payment } from './modules/payments/entities/payment.entity';
import { FinancialEvent } from './modules/finance/entities/financial-event.entity';
import { EmployeeLoan } from './modules/finance/entities/employee-loan.entity';
import { EmployeeLoanRepayment } from './modules/finance/entities/employee-loan-repayment.entity';
import { VendorSettlementPeriod } from './modules/finance/entities/vendor-settlement-period.entity';
import { DriverSettlementPeriod } from './modules/finance/entities/driver-settlement-period.entity';
import { Driver } from './modules/delivery/entities/driver.entity';
import { Delivery } from './modules/delivery/entities/delivery.entity';
import { DispatchAlert } from './modules/delivery/entities/dispatch-alert.entity';
import { AdminPermission } from './modules/permissions/entities/admin-permission.entity';
import { BusinessConfig } from './modules/business-config/entities/business-config.entity';
import { VehicleType } from './modules/business-config/entities/vehicle-type.entity';
import { HatlyServicePricingConfig } from './modules/business-config/entities/hatly-service-pricing-config.entity';
import { Upload } from './modules/uploads/entities/upload.entity';
import { VendorRating } from './modules/ratings/entities/vendor-rating.entity';
import { Offer } from './modules/offers/entities/offer.entity';
import { MarketplaceSector } from './modules/sectors/entities/marketplace-sector.entity';
import { MarketplaceSubcategory } from './modules/sectors/entities/marketplace-subcategory.entity';
import { VendorBranchSubcategory } from './modules/sectors/entities/vendor-branch-subcategory.entity';
import { Address } from './modules/addresses/entities/address.entity';
import { ServiceArea } from './modules/service-areas/entities/service-area.entity';
import { DeliveryZone } from './modules/delivery-zones/entities/delivery-zone.entity';
import { OfferProduct } from './modules/offers/entities/offer-product.entity';
import { OfferCategory } from './modules/offers/entities/offer-category.entity';
import { OfferConsumption } from './modules/offers/entities/offer-consumption.entity';
import { DriverRating } from './modules/ratings/entities/driver-rating.entity';
import { ProductRating } from './modules/ratings/entities/product-rating.entity';

@Module({
  imports: [
    // `validate` runs once at boot, before any provider is built: production/staging with missing or unsafe configuration
    // refuses to start (see config/env.validation.ts); the local hatly_dev workflow only needs what it already had.
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnvironment }),

    RequestContextModule,
    RedisModule,
    HealthModule,

    // Two limits apply to every request (see common/throttling/rate-limit-policies.ts): `default` per route per client — routes
    // can replace it with @Throttle/@Throttled — and `aggregate` across ALL routes per client, so spreading requests over many
    // routes cannot dodge the per-route limit. "Client" is the user id when authenticated, else the IP (HatlyThrottlerGuard).
    // Counters live in the shared Redis (RedisThrottlerStorage), so the limits hold across instances.
    // Verification only (the guard passes the secret per call); the real token issuing/validation stays in AuthModule.
    JwtModule.register({}),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService, redis: Redis) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: config.get<number>('rateLimits.routePerMinute') ?? 100 },
          {
            name: 'aggregate',
            ttl: 60_000,
            limit: config.get<number>('rateLimits.clientPerMinute') ?? 600,
            // No route in the key: one bucket per client for the whole API.
            generateKey: (_context, tracker, throttlerName) => `${throttlerName}-${tracker}`,
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      // Same as Nest's default (create + initialize), plus the pool-deadlock guard: at most `pool size - 1` transactions are open
      // at once, so a connection is always free for the reads made inside them (see database/transaction-limiter.ts).
      dataSourceFactory: async (options) => {
        const dataSource = await new DataSource(options!).initialize();
        const poolMax = (options as { extra?: { max?: number } } | undefined)?.extra?.max ?? 10;
        return limitConcurrentTransactions(dataSource, new TransactionLimiter(safeTransactionLimit(poolMax)));
      },
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('database.url'),
        ssl: config.get('database.sslOptions'),
        // Pool sizing/timeout (node-postgres `extra`). See config/configuration.ts for why the acquire timeout is bounded.
        extra: {
          max: config.get<number>('database.poolMax') ?? 10,
          connectionTimeoutMillis: config.get<number>('database.connectionTimeoutMs') ?? 10_000,
        },
        // CRITICAL: without this the pg driver returns every PostgreSQL bigint
        // (all `*_minor` money columns, wallet/financial/offer amounts, counters)
        // as a JavaScript STRING even though the entities declare `number`.
        // Every `a + b` over such a value then silently CONCATENATES —
        // measured against a real database, WalletService.getBalance returned
        // "0100002500-150099999999999" instead of a number. Mocked unit tests
        // could never see it. Values are integer minor units far below
        // Number.MAX_SAFE_INTEGER (~9e15 = 90 trillion EGP), so parsing to a
        // JS number is exact for every realistic amount.
        parseInt8: true,
        entities: [
          User,
          Vendor,
          VendorBranch,
          VendorStaff,
          ProductCategory,
          Product,
          ProductOption,
          ProductOptionValue,
          Cart,
          CartVendorGroup,
          CartItem,
          CartItemOptionValue,
          Order,
          OrderVendorSegment,
          OrderItem,
          AdHocPurchaseRecord,
          OrderItemWeightRecord,
          Payment,
          FinancialEvent,
          EmployeeLoan,
          EmployeeLoanRepayment,
          VendorSettlementPeriod,
          DriverSettlementPeriod,
          Driver,
          Delivery,
          DispatchAlert,
          AdminPermission,
          BusinessConfig,
          VehicleType,
          HatlyServicePricingConfig,
          Upload,
          VendorRating,
          Offer,
          OfferProduct,
          OfferCategory,
          OfferConsumption,
          DriverRating,
          ProductRating,
          MarketplaceSector,
          MarketplaceSubcategory,
          VendorBranchSubcategory,
          Address,
          ServiceArea,
          DeliveryZone,
        ],
        synchronize: false, // migrations only — see database/migrations
        autoLoadEntities: true,
      }),
    }),

    AuthModule,
    UsersModule,
    PermissionsModule,
    BusinessConfigModule,
    VendorsModule,
    ProductsModule,
    CartModule,
    UploadsModule,
    FailedDeliveryResolutionModule,
    OrdersModule,
    DeliveryModule,
    PaymentsModule,
    LocationModule,
    RatingsModule,
    FavoritesModule,
    OffersModule,
    SectorsModule,
    AddressesModule,
    ServiceAreasModule,
    DeliveryZonesModule,
    NotificationsModule,
    DiscoveryModule,
    CatalogModule,
    LoyaltyModule,
    WalletModule,
    DriverCashRemainderModule,
    AdminCustomersModule,
  ],
  providers: [
    // Order matters: JwtAuthGuard runs first (authentication — populates
    // request.user for every non-@Public() route), then ThrottlerGuard,
    // then PermissionsGuard. PermissionsGuard is global (not per-controller
    // like RolesGuard) specifically so @RequiresPermission(...) can never
    // become inert because a controller forgot @UseGuards(PermissionsGuard)
    // — it safely no-ops (returns true immediately, no user/DB check at
    // all) on any endpoint with no @RequiresPermission metadata, so this
    // adds zero behavior change for every route that doesn't use it.
    // RolesGuard remains per-controller/unchanged — not every authenticated
    // route needs a role check, and this doesn't replace that mechanism.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: HatlyThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    {
      provide: APP_FILTER,
      inject: [RequestContextService, ConfigService],
      useFactory: (requestContext: RequestContextService, config: ConfigService) =>
        new HttpExceptionFilter(requestContext, !config.get<boolean>('http.strict')),
    },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule implements NestModule {
  // Applied via middleware (not a guard/interceptor) specifically so it
  // runs before JwtAuthGuard/ThrottlerGuard/PermissionsGuard and before
  // ValidationPipe — the request context (and its correlation id) must
  // already exist for auth/validation failures too, not just successful
  // requests. See RequestContextMiddleware's own doc comment.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware, RejectNulBytesMiddleware).forRoutes('*');
  }
}
