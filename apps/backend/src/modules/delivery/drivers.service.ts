import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { Driver } from './entities/driver.entity';
import { Role } from '../../common/enums/role.enum';

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
}

@Injectable()
export class DriversService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Driver) private readonly driversRepository: Repository<Driver>,
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

      return manager.save(Driver, manager.create(Driver, { userId: user.id }));
    });
  }

  /**
   * Read-only, for the Admin Dispatch driver-picker — CONFIRMED
   * additive: does not touch DriverRankingService's own eligibility
   * filters (used only when actually assigning, per
   * AdminDispatchService), this is purely "show every driver so an
   * Admin can see who exists," never a substitute for that ranking.
   */
  async listAll(): Promise<AdminDriverView[]> {
    const drivers = await this.driversRepository.find({ relations: { user: true }, order: { createdAt: 'DESC' } });
    return drivers.map((driver) => ({
      id: driver.id,
      fullName: driver.user.fullName,
      phone: driver.user.phone,
      isOnline: driver.isOnline,
      isAvailable: driver.isAvailable,
      verificationStatus: driver.verificationStatus,
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
    const driver = await this.driversRepository.findOne({ where: { id: driverId } });
    if (!driver) {
      throw new NotFoundException('Driver not found.');
    }
    driver.verificationStatus = status;
    return this.driversRepository.save(driver);
  }
}
