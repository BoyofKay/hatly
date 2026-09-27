import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Driver } from './entities/driver.entity';
import { Delivery } from './entities/delivery.entity';

/**
 * The authorization layer every Phase C driver-facing endpoint must
 * use — mirrors VendorStaffAuthorizationService's role in Phase B
 * exactly. Confirmed gap this exists to close: the existing
 * ASSIGNED_TO_DRIVER/PICKED_UP/ON_THE_WAY/DELIVERED transitions in
 * OrderStateMachineService are role-gated (Role.DRIVER) but have NO
 * ownership check at all — any driver could act on any order. This
 * service is the fix, applied as a wrapper (see
 * DriverOrderActionsService), never by modifying the transition table
 * itself.
 */
@Injectable()
export class DriverAuthorizationService {
  constructor(
    @InjectRepository(Driver) private readonly driversRepository: Repository<Driver>,
    @InjectRepository(Delivery) private readonly deliveriesRepository: Repository<Delivery>,
  ) {}

  /** Throws if the authenticated user has no Driver profile — should not normally happen for a Role.DRIVER JWT, but never assumed. */
  async getDriverForUser(userId: string): Promise<Driver> {
    const driver = await this.driversRepository.findOne({ where: { userId } });
    if (!driver) {
      throw new NotFoundException('Driver profile not found.');
    }
    return driver;
  }

  /**
   * Returns the Delivery only if it belongs to this driver — same
   * "don't leak which case" pattern used throughout this codebase
   * (e.g. CartService.getOwnedCartForItem, VendorOrdersService): a
   * non-existent delivery and someone else's delivery both surface as
   * NotFoundException, never a distinguishable Forbidden vs NotFound.
   */
  async assertOwnsDelivery(driverId: string, deliveryId: string): Promise<Delivery> {
    const delivery = await this.deliveriesRepository.findOne({ where: { id: deliveryId } });
    if (!delivery || delivery.driverId !== driverId) {
      throw new NotFoundException('Delivery not found.');
    }
    return delivery;
  }
}
