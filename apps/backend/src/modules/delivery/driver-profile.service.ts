import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Driver } from './entities/driver.entity';
import { DriverAuthorizationService } from './driver-authorization.service';

/**
 * Driver self-service profile updates — distinct from Phase A's
 * DriversService, which is admin-only onboarding. This is the driver
 * acting on their own record, same "role-gated, not
 * permission-gated" precedent Phase B established for vendors acting
 * on their own data.
 *
 * CONFIRMED: `lastLatitude`/`lastLongitude` recorded here are NEVER
 * read by DeliveryFeeCalculationService or any pricing path — that
 * service's only dependencies are MapProvider and BusinessConfigService
 * (structurally verified when it was built); this location write is
 * an entirely separate concern (driver-app operational data, for a
 * future Dispatch engine — not built yet), not a pricing input.
 */
@Injectable()
export class DriverProfileService {
  constructor(
    @InjectRepository(Driver) private readonly driversRepository: Repository<Driver>,
    private readonly driverAuthorizationService: DriverAuthorizationService,
  ) {}

  /**
   * Operational Completion milestone fix: every driver-row write is a column-targeted UPDATE. These used to load the whole
   * row and `save()` it — TypeORM then writes back every column that differs from the database, so a location heartbeat
   * (sent on a timer by the driver app) or an online toggle that read the row just before an assignment committed wrote the
   * stale `is_available = true` back: the driver looked free while carrying an order, and could be double-booked.
   */
  async setOnlineStatus(userId: string, isOnline: boolean): Promise<Driver> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    // Presence: the time of the switch marks one online/offline incident (only when it really changes).
    if (driver.isOnline !== isOnline) await this.driversRepository.update({ id: driver.id }, { isOnline, onlineChangedAt: new Date() });
    else await this.driversRepository.update({ id: driver.id }, { isOnline });
    // Driver shifts (2026-11-22): the older apps' online switch still records a shift — going online opens one if none is open. Going
    // offline only stops new orders; the shift itself is ended by the driver's "End shift" or by the closing at the office.
    if (isOnline) await this.driversRepository.query(`INSERT INTO driver_shifts (driver_id) VALUES ($1) ON CONFLICT DO NOTHING`, [driver.id]);
    return this.driversRepository.findOneOrFail({ where: { id: driver.id } });
  }

  /** Read-only: is this driver online for dispatch right now (the server's switch, not the app's memory). */
  async getOnlineStatus(userId: string): Promise<{ isOnline: boolean }> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    return { isOnline: Boolean(driver.isOnline) };
  }

  async updateLocation(userId: string, latitude: number, longitude: number): Promise<Driver> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    await this.driversRepository.update({ id: driver.id }, { lastLatitude: latitude, lastLongitude: longitude, lastLocationAt: new Date() });
    return this.driversRepository.findOneOrFail({ where: { id: driver.id } });
  }
}
