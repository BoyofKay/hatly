import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { Driver } from './entities/driver.entity';
import { Role } from '../../common/enums/role.enum';
import { VehicleTypesService } from '../business-config/vehicle-types.service';

/**
 * PHASE I-A, CHUNK 6 addition to this interface: the read-only view
 * `listAll()` returns — for the Admin Dispatch driver-picker. Purely
 * additive; `create()` below is entirely unchanged.
 */
export interface AdminDriverView {
  id: string;
  fullName: string;
  phone: string;
  isOnline: boolean;
  isAvailable: boolean;
  verificationStatus: string;
  /** Control Tower milestone (additive): the operational facts an admin needs to pick / follow a driver. */
  vehicleTypeName: string | null;
  /** Operational Completion milestone (additive): for the admin vehicle picker. */
  vehicleTypeId: string | null;
  lastLocationAt: Date | null;
  /** The order this driver is currently on (ASSIGNED_TO_DRIVER / PICKED_UP / ON_THE_WAY), if any. */
  activeDelivery: { orderId: string; orderNumber: string; status: string } | null;
  /** R28: Hatly's commission on this driver's delivery compensation, basis points (null = not set yet — nothing is recognised). */
  commissionRateBasisPoints: number | null;
}

@Injectable()
export class DriversService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Driver) private readonly driversRepository: Repository<Driver>,
    private readonly vehicleTypesService: VehicleTypesService,
  ) {}

  /**
   * Creates a new DRIVER user account and its Driver profile row, in
   * one transaction. Same phone-uniqueness rejection reasoning as
   * VendorStaffService.create() — see that file's own doc comment.
   *
   * The Driver entity already existed with a proper userId FK before
   * this (Phase 1) — but nothing anywhere ever created a row in it,
   * confirmed by inspection. This is the first real writer.
   *
   * PHASE I-A, CHUNK 5 addition: `password` is now required — Admin
   * provisions the credential the driver actually logs in with (the
   * locked "Driver password login, not OTP" decision). Hashed with
   * `bcrypt` (already an existing dependency — confirmed by
   * inspection, `User.passwordHash` was a nullable, unwired column
   * before this; this is the first real writer of it too). The plain
   * password is never persisted or logged anywhere — only the hash.
   */
  async create(params: { phone: string; fullName: string; password: string }): Promise<Driver> {
    const passwordHash = await bcrypt.hash(params.password, 10);

    return this.dataSource.transaction(async (manager) => {
      const existingUser = await manager.findOne(User, { where: { phone: params.phone } });
      if (existingUser) {
        throw new ConflictException({
          message: 'An account with this phone number already exists.',
          details: { code: 'PHONE_ALREADY_REGISTERED' },
        });
      }

      const user = await manager.save(
        User,
        manager.create(User, { phone: params.phone, fullName: params.fullName, role: Role.DRIVER, passwordHash }),
      );

      // `isAvailable` means "has no active delivery" (see Driver.isAvailable and the state machine's release rule): a brand-new
      // driver has none. Before this, it defaulted to false and nothing ever set it, so an admin-created, approved, online
      // driver could never be dispatched (Control Tower milestone fix). Ranking still requires APPROVED + online.
      return manager.save(Driver, manager.create(Driver, { userId: user.id, isAvailable: true }));
    });
  }

  /**
   * Read-only, for the Admin Dispatch driver-picker — CONFIRMED
   * additive: does not touch DriverRankingService's own eligibility
   * filters (used only when actually assigning, per
   * AdminDispatchService), this is purely "show every driver so an
   * Admin can see who exists," never a substitute for that ranking.
   */
  async listAll(options: { approvedOnly?: boolean; driverId?: string } = {}): Promise<AdminDriverView[]> {
    const where = {
      ...(options.approvedOnly ? { verificationStatus: 'APPROVED' as const } : {}),
      ...(options.driverId ? { id: options.driverId } : {}),
    };
    const drivers = await this.driversRepository.find({
      where: Object.keys(where).length > 0 ? where : undefined,
      relations: { user: true, vehicleType: true },
      order: { createdAt: 'DESC' },
    });
    // One batched lookup of who is on which active order — never a query per driver.
    const active: Array<{ driver_id: string; order_id: string; order_number: string; status: string }> =
      drivers.length > 0
        ? await this.dataSource.query(
            `SELECT DISTINCT ON (dl.driver_id) dl.driver_id, o.id AS order_id, o.order_number, o.status::text AS status
               FROM deliveries dl JOIN orders o ON o.id = dl.order_id
              WHERE dl.driver_id = ANY($1) AND o.status IN ('ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY')
              ORDER BY dl.driver_id, dl.assigned_at DESC NULLS LAST`,
            [drivers.map((d) => d.id)],
          )
        : [];
    const activeByDriver = new Map(active.map((a) => [a.driver_id, { orderId: a.order_id, orderNumber: a.order_number, status: a.status }]));
    return drivers.map((driver) => ({
      id: driver.id,
      fullName: driver.user.fullName,
      phone: driver.user.phone,
      isOnline: driver.isOnline,
      isAvailable: driver.isAvailable,
      verificationStatus: driver.verificationStatus,
      vehicleTypeName: driver.vehicleType?.name ?? null,
      vehicleTypeId: driver.vehicleTypeId ?? null,
      lastLocationAt: driver.lastLocationAt ?? null,
      activeDelivery: activeByDriver.get(driver.id) ?? null,
      commissionRateBasisPoints: driver.commissionRateBasisPoints ?? null,
    }));
  }

  /**
   * Driver Core + Dispatch Foundation milestone. Closes a real, confirmed gap: `Driver.verificationStatus`
   * defaults to `'PENDING'` and — before this — nothing anywhere ever moved it to `'APPROVED'`, so an
   * Admin-created driver could never actually be ranked/assigned (`DriverRankingService.rankCandidates`
   * requires exactly `'APPROVED'`). No new state: reuses the entity's own existing three-value union.
   * `REJECTED` is likewise final here (an Admin who wants to reconsider re-approves the same driver; no
   * separate re-review workflow is invented).
   */
  async setVerificationStatus(driverId: string, status: 'APPROVED' | 'REJECTED'): Promise<Driver> {
    await this.requireDriver(driverId);
    // Column-targeted (Operational Completion milestone): never writes back a stale is_available / is_online.
    await this.driversRepository.update({ id: driverId }, { verificationStatus: status });
    return this.driversRepository.findOneOrFail({ where: { id: driverId } });
  }

  /**
   * Operational Completion milestone — the admin sets (or clears, `null`) a driver's vehicle type from the existing
   * `vehicle_types` catalog. No category is invented here: only an existing, ACTIVE catalog row can be given (a deactivated
   * type stays on drivers who already have it, but is not handed out anew). A vehicle type stays OPTIONAL for dispatch — a
   * driver without one is ranked like any other (only a type flagged `isBicycle` is distance-limited, at ranking time).
   * Allowed whatever the driver is doing: an assignment already made is never revisited; the type applies from the next
   * ranking — exactly the outcome of the change landing just after that assignment.
   * Column-targeted: never writes back a stale is_available / is_online.
   */
  async setVehicleType(driverId: string, vehicleTypeId: string | null): Promise<AdminDriverView> {
    await this.requireDriver(driverId);
    if (vehicleTypeId !== null) {
      const vehicleType = await this.vehicleTypesService.findById(vehicleTypeId);
      if (!vehicleType) {
        throw new BadRequestException({ message: 'This vehicle type does not exist.', details: { code: 'VEHICLE_TYPE_NOT_FOUND' } });
      }
      if (!vehicleType.isActive) {
        throw new BadRequestException({ message: 'This vehicle type is inactive.', details: { code: 'VEHICLE_TYPE_INACTIVE' } });
      }
    }
    await this.driversRepository.update({ id: driverId }, { vehicleTypeId });
    const [view] = await this.listAll({ driverId });
    return view;
  }

  private async requireDriver(driverId: string): Promise<Driver> {
    const driver = await this.driversRepository.findOne({ where: { id: driverId } });
    if (!driver) {
      throw new NotFoundException('Driver not found.');
    }
    return driver;
  }
}
