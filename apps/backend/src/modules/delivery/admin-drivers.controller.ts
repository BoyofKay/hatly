import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresAnyPermission } from '../permissions/decorators/requires-permission.decorator';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';
import { driverLoad, recomputeDriverAvailability } from './driver-capacity';
import { ApiTags } from '@nestjs/swagger';
import { RequiresPermission } from '../permissions/decorators/requires-permission.decorator';
import { Permission } from '../permissions/permission.enum';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverVerificationDto } from './dto/update-driver-verification.dto';
import { UpdateDriverVehicleTypeDto } from './dto/update-driver-vehicle-type.dto';
import { VehicleTypesService } from '../business-config/vehicle-types.service';

@ApiTags('admin-drivers')
@Controller('admin/drivers')
export class AdminDriversController {
  constructor(
    private readonly driversService: DriversService,
    private readonly vehicleTypesService: VehicleTypesService,
    private readonly ds: DataSource,
    private readonly audit: AdminAuditService,
  ) {}

  /** R18: a driver's capacity (override or vehicle), current active orders, and every override with its reason, approver and time. */
  @Get(':id/capacity')
  @RequiresAnyPermission(Permission.MANAGE_DRIVERS, Permission.OVERRIDE_DISPATCH, Permission.ASSIGN_REASSIGN_ORDERS)
  async capacity(@Param('id', ParseUUIDPipe) id: string) {
    const [d] = await this.ds.query(`SELECT id FROM drivers WHERE id = $1`, [id]);
    if (!d) throw new NotFoundException('Driver not found.');
    const history = await this.ds.query(
      `SELECT h.before_override, h.after_override, h.effective_before, h.effective_after, h.reason, h.created_at, u.full_name AS approved_by
         FROM driver_capacity_overrides h JOIN users u ON u.id = h.approved_by_user_id WHERE h.driver_id = $1 ORDER BY h.created_at DESC LIMIT 20`,
      [id],
    );
    return {
      data: {
        ...(await driverLoad(this.ds, id)),
        history: history.map((h: any) => ({ beforeOverride: h.before_override, afterOverride: h.after_override, effectiveBefore: h.effective_before, effectiveAfter: h.effective_after, reason: h.reason, approvedBy: h.approved_by, at: h.created_at })),
      },
    };
  }

  /**
   * R18: override (or clear, `capacity: null`) one driver's capacity. Records the reason, the approver (the signed-in admin), the time and the
   * before/after; recomputes whether the driver has room. Lowering it below the orders they already carry never takes an order away — they
   * simply get no new one until they are under it. Requires OVERRIDE_DISPATCH.
   */
  @Patch(':id/capacity')
  @RequiresPermission(Permission.OVERRIDE_DISPATCH)
  async setCapacity(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { capacity?: number | null; reason?: string }) {
    const capacity = body?.capacity === null ? null : Number(body?.capacity);
    if (capacity !== null && !(Number.isInteger(capacity) && capacity >= 1 && capacity <= 20)) {
      throw new BadRequestException({ message: 'Capacity must be a whole number from 1 to 20, or empty to use the vehicle type.', details: { code: 'VALIDATION_FAILED' } });
    }
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3 || reason.length > 300) throw new BadRequestException({ message: 'Give a reason of 3–300 characters.', details: { code: 'REASON_REQUIRED' } });
    await this.ds.transaction(async (m) => {
      const [d] = await m.query(`SELECT id, capacity_override FROM drivers WHERE id = $1 FOR UPDATE`, [id]);
      if (!d) throw new NotFoundException('Driver not found.');
      const before = await driverLoad(m, id);
      await m.query(`UPDATE drivers SET capacity_override = $2 WHERE id = $1`, [id, capacity]);
      await recomputeDriverAvailability(m, [id]);
      const after = await driverLoad(m, id);
      await m.query(
        `INSERT INTO driver_capacity_overrides (driver_id, before_override, after_override, effective_before, effective_after, reason, approved_by_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, d.capacity_override, capacity, before.capacity, after.capacity, reason, user.id],
      );
      await this.audit.record({ actorUserId: user.id, actorRole: user.role, action: AdminAuditAction.DRIVER_CAPACITY_OVERRIDDEN, targetType: 'driver', targetId: id, metadata: { before: d.capacity_override, after: capacity, effectiveBefore: before.capacity, effectiveAfter: after.capacity, reason } } as never, m);
    });
    return this.capacity(id);
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_DRIVERS)
  async create(@Body() dto: CreateDriverDto) {
    const driver = await this.driversService.create(dto);
    return { data: driver };
  }

  /**
   * PHASE I-A, CHUNK 6 addition — for the Admin Dispatch driver-picker.
   * Reuses MANAGE_DRIVERS (already covers this controller entirely);
   * no new permission introduced.
   */
  @Get()
  @RequiresPermission(Permission.MANAGE_DRIVERS)
  async list() {
    const drivers = await this.driversService.listAll();
    return { data: drivers };
  }

  /**
   * Driver Core + Dispatch Foundation milestone. Same MANAGE_DRIVERS permission as the rest of this
   * controller — no new permission introduced.
   */
  @Patch(':id/verification')
  @RequiresPermission(Permission.MANAGE_DRIVERS)
  async setVerification(@Param('id') id: string, @Body() dto: UpdateDriverVerificationDto) {
    const driver = await this.driversService.setVerificationStatus(id, dto.status);
    return { data: driver };
  }

  /**
   * Operational Completion milestone — the ACTIVE vehicle types an admin can give a driver (the picker on the Drivers page).
   * MANAGE_DRIVERS, like the action it serves: the full catalog (incl. inactive rows and its editing) stays MANAGE_VEHICLE_TYPES.
   * Registered before `:id/…` routes; a static path never collides with them.
   */
  @Get('vehicle-types')
  @RequiresPermission(Permission.MANAGE_DRIVERS)
  async vehicleTypes() {
    const rows = await this.vehicleTypesService.list(false);
    return { data: rows.map((v) => ({ id: v.id, name: v.name, nameAr: v.nameAr ?? null, isBicycle: v.isBicycle })) };
  }

  /** Operational Completion milestone — set or clear (`null`) a driver's vehicle type. Same MANAGE_DRIVERS as the rest. */
  @Patch(':id/vehicle-type')
  @RequiresPermission(Permission.MANAGE_DRIVERS)
  async setVehicleType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDriverVehicleTypeDto) {
    return { data: await this.driversService.setVehicleType(id, dto.vehicleTypeId) };
  }
}
