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

  async setOnlineStatus(userId: string, isOnline: boolean): Promise<Driver> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    driver.isOnline = isOnline;
    return this.driversRepository.save(driver);
  }

  async updateLocation(userId: string, latitude: number, longitude: number): Promise<Driver> {
    const driver = await this.driverAuthorizationService.getDriverForUser(userId);
    driver.lastLatitude = latitude;
    driver.lastLongitude = longitude;
    driver.lastLocationAt = new Date();
    return this.driversRepository.save(driver);
  }
}
