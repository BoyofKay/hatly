import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Order } from './entities/order.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';
import { PermissionsService } from '../permissions/permissions.service';
import { Permission } from '../permissions/permission.enum';

/**
 * Ownership / permission gate for the generic `PATCH /orders/:id/status` endpoint.
 *
 * `OrderStateMachineService.transition()` only validates the ROLE that is allowed to make a
 * transition ("a driver may mark PICKED_UP"); it has no notion of WHICH driver/vendor/customer
 * may act on WHICH order, because its other callers (the segment state machine, dispatch,
 * driver actions) have already authorized the actor against the specific order. This endpoint
 * had no such check, so any driver could move any other driver's order to PICKED_UP, and any
 * vendor could cancel (and thereby trigger inventory restoration and refunds for) any other
 * vendor's order — found by the Group 8 end-to-end journeys.
 *
 * Every refusal for a non-owner is a 404 identical to "no such order", so the endpoint does not
 * reveal which order ids exist.
 */
@Injectable()
export class OrderActorAuthorizationService {
  constructor(
    @InjectRepository(Order) private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderVendorSegment) private readonly segmentsRepository: Repository<OrderVendorSegment>,
    @InjectRepository(Delivery) private readonly deliveriesRepository: Repository<Delivery>,
    @InjectRepository(Driver) private readonly driversRepository: Repository<Driver>,
    private readonly vendorStaffAuthorizationService: VendorStaffAuthorizationService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async assertMayActOnOrder(user: AuthenticatedUser, orderId: string): Promise<void> {
    const notFound = () => new NotFoundException('Order not found.');

    switch (user.role) {
      case Role.SUPER_ADMIN:
        return;

      case Role.ADMIN: {
        // Cancelling/failing/advancing an order is an operational "order issue" action, so an
        // ADMIN needs the same permission the failed-delivery resolution endpoints require.
        if (!(await this.permissionsService.hasPermission(user.id, Permission.MANAGE_ORDER_ISSUES))) {
          throw new ForbiddenException('You do not have permission to perform this action.');
        }
        return;
      }

      case Role.CUSTOMER: {
        const order = await this.ordersRepository.findOne({ where: { id: orderId } });
        if (!order || order.customerId !== user.id) throw notFound();
        return;
      }

      case Role.VENDOR:
      case Role.VENDOR_MANAGER: {
        const ownedBranchIds = await this.vendorStaffAuthorizationService.getOwnedBranchIds(user.id);
        if (ownedBranchIds.length === 0) throw notFound();
        const segments = await this.segmentsRepository.find({ where: { orderId }, select: { id: true, vendorBranchId: true } });
        if (!segments.some((s) => s.vendorBranchId != null && ownedBranchIds.includes(s.vendorBranchId))) throw notFound();
        return;
      }

      case Role.DRIVER: {
        const driver = await this.driversRepository.findOne({ where: { userId: user.id } });
        if (!driver) throw notFound();
        const delivery = await this.deliveriesRepository.findOne({ where: { orderId } });
        if (!delivery || delivery.driverId !== driver.id) throw notFound();
        return;
      }

      default:
        throw notFound();
    }
  }

  /**
   * Approved rule (PD-002): a vendor may cancel only ITS OWN order segment(s), never someone else's part of a
   * multi-vendor order. The order-level CANCELLED transition is therefore open to a vendor only when every segment
   * that is still active is one of that vendor's own (the single-vendor case, or the last vendor standing) — in
   * which case cancelling the order is exactly cancelling its own remaining segment(s). Otherwise the vendor must use
   * `PATCH /vendor/orders/segments/:segmentId/status` for its own segment.
   */
  async assertVendorMayCancelWholeOrder(user: AuthenticatedUser, orderId: string): Promise<void> {
    if (user.role !== Role.VENDOR && user.role !== Role.VENDOR_MANAGER) return;

    const ownedBranchIds = await this.vendorStaffAuthorizationService.getOwnedBranchIds(user.id);
    const segments = await this.segmentsRepository.find({
      where: { orderId },
      select: { id: true, vendorBranchId: true, status: true },
    });
    const active = segments.filter((s) => s.status !== OrderVendorSegmentStatus.CANCELLED);
    const foreign = active.some((s) => s.vendorBranchId == null || !ownedBranchIds.includes(s.vendorBranchId));
    if (foreign) {
      throw new ForbiddenException({
        message:
          'A vendor can only cancel its own part of a multi-vendor order. Cancel your own segment instead of the whole order.',
        details: { code: 'VENDOR_MAY_ONLY_CANCEL_OWN_SEGMENT' },
      });
    }
  }
}
