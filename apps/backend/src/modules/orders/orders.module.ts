import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderItem } from './entities/order-item.entity';
import { AdHocPurchaseRecord } from './entities/ad-hoc-purchase-record.entity';
import { OrderItemWeightRecord } from './entities/order-item-weight-record.entity';
import { Cart } from '../cart/entities/cart.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { Payment } from '../payments/entities/payment.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { User } from '../users/entities/user.entity';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrderActorAuthorizationService } from './order-actor-authorization.service';
import { OrderVendorSegmentStateMachineService } from './order-vendor-segment-state-machine.service';
import { OrderReadinessService } from './order-readiness.service';
import { AdHocFulfilmentService } from './ad-hoc-fulfilment.service';
import { OrderSegmentCancellationService } from './order-segment-cancellation.service';
import { CustomerOrderCancellationService } from './customer-order-cancellation.service';
import { CheckoutController } from './checkout/checkout.controller';
import { GeoController } from './checkout/geo.controller';
import { CheckoutPlannerService } from './checkout/checkout-planner.service';
import { CheckoutQuoteService } from './checkout/checkout-quote.service';
import { CheckoutQuoteTokenService } from './checkout/checkout-quote-token.service';
import { AddressValidationService } from './checkout/address-validation.service';
import { OrderPaymentGateService } from './order-payment-gate.service';
import { OrderStatusHistoryService } from './order-status-history.service';
import { OrderWalletRefundService } from './order-wallet-refund.service';
import { OrderEtaService } from './order-eta.service';
import { OrderStatusEvent } from './entities/order-status-event.entity';
import { Address } from '../addresses/entities/address.entity';
import { DeliveryZone } from '../delivery-zones/entities/delivery-zone.entity';
import { WalletModule } from '../wallet/wallet.module';
import { LocationModule } from '../location/location.module';
import { ServiceAreasModule } from '../service-areas/service-areas.module';
import { OrderCreationService } from './order-creation.service';
import { AdHocPurchaseRecordService } from './ad-hoc-purchase-record.service';
import { OrderItemWeightRecordService } from './order-item-weight-record.service';
import { VendorWeightRecordService } from './vendor-weight-record.service';
import { CustomerOrdersService } from './customer-orders.service';
import { OrderItemRemovalService } from './exceptions/order-item-removal.service';
import { OrderExceptionsService } from './exceptions/order-exceptions.service';
import { VendorUnavailableItemsController, CustomerItemUnavailabilityController } from './exceptions/order-exceptions.controllers';
import { ChangeFeedService } from './changes/change-feed.service';
import { AdminChangesController, VendorChangesController } from './changes/change-feed.controllers';
import { VendorBusinessService } from './vendor-business.service';
import { BranchClosuresService } from './branch-closures.service';
import { BranchChangeRequestsService } from './branch-change-requests.service';
import { AdminBranchChangeRequestsController, VendorBranchChangeRequestsController } from './branch-change-requests.controllers';
import { StockLedgerService } from './stock-ledger.service';
import { VendorFinanceService } from './vendor-finance.service';
import { VendorTeamService } from './vendor-team.service';
import { AdminBranchClosuresController, AdminVendorSettlementTermsController, VendorBranchClosuresController, VendorFinanceController, VendorInventoryController, VendorTeamController } from './vendor-operations.controllers';
import { VendorBranchProfileController, VendorBusinessController, VendorOrderHistoryController } from './vendor-business.controllers';
import { OrdersController } from './orders.controller';
import { VendorOrdersController } from './vendor-orders.controller';
import { VendorOrdersService } from './vendor-orders.service';
import { CartPricingService } from '../cart/cart-pricing.service';
import { BusinessConfigModule } from '../business-config/business-config.module';
import { DeliveryFeeCalculationModule } from '../delivery-fee/delivery-fee-calculation.module';
import { VendorsModule } from '../vendors/vendors.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { FinanceModule } from '../finance/finance.module';
import { OffersModule } from '../offers/offers.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { PaymentsModule } from '../payments/payments.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { DriverCashRemainderModule } from '../driver-cash-remainder/driver-cash-remainder.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeliveryZone,
      Order,
      OrderVendorSegment,
      OrderItem,
      AdHocPurchaseRecord,
      OrderItemWeightRecord,
      Cart,
      VendorBranch,
      Payment,
      OrderStatusEvent,
      Address,
      Delivery,
      Driver,
      User,
    ]),
    BusinessConfigModule,
    DeliveryFeeCalculationModule,
    VendorsModule,
    // PHASE 4 DISPATCH addition: a genuine mutual dependency, not an
    // accident — DeliveryModule needs Order/OrderVendorSegment data
    // (already imported OrdersModule since Phase C), and now
    // OrderVendorSegmentStateMachineService needs to trigger
    // DeliveryModule's AutomaticDispatchService once a segment reaches
    // READY_FOR_PICKUP. forwardRef() is NestJS's standard, documented
    // solution for exactly this case.
    forwardRef(() => DeliveryModule),
    // PHASE F addition: one-directional only — FinanceModule needs no
    // service from OrdersModule (only entities, registered directly in
    // its own forFeature — see FinanceModule's own comment), so no
    // forwardRef is needed here, unlike DeliveryModule above.
    FinanceModule,
    OffersModule,
    LoyaltyModule,
    PaymentsModule,
    DiscoveryModule,
    DriverCashRemainderModule,
    // Customer Push Notifications (Chunk A): one-directional only —
    // OrderStateMachineService needs PushNotificationService (already
    // exported by NotificationsModule for exactly this kind of use,
    // per that module's own comment), no forwardRef needed, same
    // shape as FinanceModule's own import above.
    NotificationsModule,
    PermissionsModule,
    WalletModule,
    LocationModule,
    ServiceAreasModule,
  ],
  controllers: [AdminBranchChangeRequestsController, VendorBranchChangeRequestsController, OrdersController, VendorUnavailableItemsController, CustomerItemUnavailabilityController, VendorChangesController, VendorOrderHistoryController, VendorBusinessController, VendorBranchProfileController, VendorTeamController, VendorBranchClosuresController, VendorInventoryController, VendorFinanceController, AdminVendorSettlementTermsController, AdminBranchClosuresController, AdminChangesController, VendorOrdersController, AdminOrdersController, CheckoutController, GeoController],
  providers: [
    OrderStateMachineService,
    OrderActorAuthorizationService,
    OrderVendorSegmentStateMachineService,
    OrderReadinessService,
    AdHocFulfilmentService,
    OrderSegmentCancellationService,
    CustomerOrderCancellationService,
    CheckoutPlannerService,
    CheckoutQuoteService,
    CheckoutQuoteTokenService,
    AddressValidationService,
    OrderPaymentGateService,
    OrderStatusHistoryService,
    OrderWalletRefundService,
    OrderEtaService,
    OrderCreationService,
    AdHocPurchaseRecordService,
    OrderItemWeightRecordService,
    VendorWeightRecordService,
    VendorOrdersService,
    CustomerOrdersService,
    CartPricingService,
    AdminOrdersService,
    OrderItemRemovalService,
    OrderExceptionsService,
    ChangeFeedService,
    VendorBusinessService,
    BranchClosuresService,
    BranchChangeRequestsService,
    StockLedgerService,
    VendorFinanceService,
    VendorTeamService,
  ],
  // OrderItemWeightRecordService exported for DeliveryModule's
  // DriverWeightRecordService — same forwardRef-based cross-module
  // dependency shape already established for AdHocPurchaseRecordService
  // / DriverPurchaseService. CONFIRMED: no Admin-facing controller or
  // correction path exists for weighted items anywhere in this module
  // — Admin plays no role in weight/weighted-price entry or correction.
  // M3c (Launch-Readiness Gap Audit, G-10): AdminOrdersService exported so AdminCustomersModule can
  // reuse its `search()` for a customer's "recent orders" summary without duplicating that query.
  exports: [AdHocFulfilmentService, OrderStateMachineService, AdHocPurchaseRecordService, OrderItemWeightRecordService, AdminOrdersService, OrderExceptionsService],
})
export class OrdersModule {}
