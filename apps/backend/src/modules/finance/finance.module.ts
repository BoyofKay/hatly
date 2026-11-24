import { DriverCommissionRepairService } from './driver-commission-repair.service';
import { DriverAllowanceService } from './driver-allowance.service';
import { AdminDriverAllowancesController } from './admin-driver-allowances.controller';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinancialEvent } from './entities/financial-event.entity';
import { EmployeeLoan } from './entities/employee-loan.entity';
import { EmployeeLoanRepayment } from './entities/employee-loan-repayment.entity';
import { VendorSettlementPeriod } from './entities/vendor-settlement-period.entity';
import { DriverSettlementPeriod } from './entities/driver-settlement-period.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderVendorSegment } from '../orders/entities/order-vendor-segment.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Payment } from '../payments/entities/payment.entity';
import { FinancialEventService } from './financial-event.service';
import { OrderFinancialEventsService } from './order-financial-events.service';
import { HatlyServicePricingService } from './hatly-service-pricing.service';
import { EmployeeLoanService } from './employee-loan.service';
import { SettlementService } from './settlement.service';
import { SettlementClosingService } from './settlement-closing.service';
import { AdminEmployeeLoansController } from './admin-employee-loans.controller';
import { AdminCommissionConfigController } from './admin-commission-config.controller';
import { AdminSettlementController } from './admin-settlement.controller';
import { LocationModule } from '../location/location.module';
import { BusinessConfigModule } from '../business-config/business-config.module';
import { DeliveryFeeCalculationModule } from '../delivery-fee/delivery-fee-calculation.module';

/**
 * No import of OrdersModule/VendorsModule/DeliveryModule/PaymentsModule
 * here — every entity this module's services need is registered
 * directly via TypeOrmModule.forFeature, the same pattern already
 * used elsewhere in this codebase for entities shared across module
 * boundaries (e.g. VendorBranch already appears in the cart, orders,
 * and delivery modules' own forFeature lists). This module needs no
 * SERVICE from any of those modules, only their entities — so
 * OrdersModule/PaymentsModule can safely import THIS module
 * one-directionally, with no cycle and no forwardRef required.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FinancialEvent,
      EmployeeLoan,
      EmployeeLoanRepayment,
      VendorSettlementPeriod,
      DriverSettlementPeriod,
      Order,
      OrderVendorSegment,
      VendorBranch,
      Driver,
      Delivery,
      Payment,
    ]),
    LocationModule,
    BusinessConfigModule,
    DeliveryFeeCalculationModule,
  ],
  controllers: [AdminEmployeeLoansController, AdminCommissionConfigController, AdminSettlementController, AdminDriverAllowancesController],
  providers: [
    FinancialEventService,
    OrderFinancialEventsService,
    HatlyServicePricingService,
    EmployeeLoanService,
    SettlementService,
    SettlementClosingService,
    DriverAllowanceService,
    DriverCommissionRepairService,
  ],
  exports: [DriverAllowanceService, SettlementClosingService, FinancialEventService, OrderFinancialEventsService, HatlyServicePricingService, EmployeeLoanService],
})
export class FinanceModule {}
