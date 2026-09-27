import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderItem } from './entities/order-item.entity';
import { OrderItemWeightRecord } from './entities/order-item-weight-record.entity';
import { OrderItemWeightRecordService } from './order-item-weight-record.service';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';

/**
 * A thin ownership-checked wrapper — exactly mirrors DriverPurchaseService's
 * role for the AD_HOC_SERVICE purchase-amount flow, applied here to
 * the Vendor side of weight recording. Does NOT redesign
 * OrderItemWeightRecordService.record() itself — adds the one missing
 * piece: confirming the calling user actually manages (via
 * VendorStaff) the branch that owns this item's segment, before
 * delegating to the existing, already-tested immutable-record logic.
 */
@Injectable()
export class VendorWeightRecordService {
  constructor(
    @InjectRepository(OrderItem) private readonly orderItemsRepository: Repository<OrderItem>,
    private readonly vendorStaffAuthorizationService: VendorStaffAuthorizationService,
    private readonly orderItemWeightRecordService: OrderItemWeightRecordService,
  ) {}

  async recordWeight(params: {
    userId: string;
    orderItemId: string;
    weightGrams: number;
  }): Promise<OrderItemWeightRecord> {
    const item = await this.orderItemsRepository.findOne({
      where: { id: params.orderItemId },
      relations: { orderVendorSegment: true },
    });
    if (!item) {
      throw new NotFoundException('Order item not found.');
    }
    if (!item.orderVendorSegment.vendorBranchId) {
      // AD_HOC_SERVICE segments have no VendorBranch — nothing to
      // authorize a Vendor against, same as the segment state machine's
      // own guard.
      throw new NotFoundException('Order item not found.');
    }

    await this.vendorStaffAuthorizationService.assertOwnsBranch(
      params.userId,
      item.orderVendorSegment.vendorBranchId,
    );

    return this.orderItemWeightRecordService.record({
      orderItemId: params.orderItemId,
      weightGrams: params.weightGrams,
      recordedByUserId: params.userId,
    });
  }
}
