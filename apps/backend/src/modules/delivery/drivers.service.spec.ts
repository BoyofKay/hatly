import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DriversService } from './drivers.service';
import { User } from '../users/entities/user.entity';
import { Driver } from './entities/driver.entity';
import { Role } from '../../common/enums/role.enum';

function buildHarness(seed: { users?: any[] } = {}) {
  const users = new Map((seed.users ?? []).map((u) => [u.phone, u]));
  const driverRows: any[] = [];

  const manager = {
    findOne: async (EntityClass: any, opts: any) => {
      if (EntityClass === User) return users.get(opts.where.phone) ?? null;
      throw new Error(`unhandled findOne ${EntityClass.name}`);
    },
    create: (_EntityClass: any, data: any) => ({ ...data }),
    save: async (EntityClass: any, entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      if (EntityClass === User) users.set(withId.phone, withId);
      else if (EntityClass === Driver) driverRows.push(withId);
      return withId;
    },
  };

  const dataSource = { transaction: async (cb: any) => cb(manager) };
  const driversRepository = { find: jest.fn(async () => driverRows) };
  const service = new DriversService(dataSource as any, driversRepository as any, {} as any);
  return { service, users, driverRows };
}

describe('DriversService', () => {
  it('creates a DRIVER user and its Driver profile row', async () => {
    const { service, users, driverRows } = buildHarness();

    const driver = await service.create({ phone: '+201000000005', fullName: 'New Driver', password: 'a-secure-password' });

    expect(users.get('+201000000005').role).toBe(Role.DRIVER);
    expect(driverRows).toHaveLength(1);
    expect(driver.userId).toBe(users.get('+201000000005').id);
    // A new driver has no delivery, so they are available (Control Tower milestone fix) — still PENDING verification and
    // offline, so ranking cannot pick them until an admin approves them and they go online.
    expect(driver.isAvailable).toBe(true);
  });

  it('rejects when the phone number is already registered', async () => {
    const { service } = buildHarness({
      users: [{ id: 'existing-1', phone: '+201000000006', role: Role.CUSTOMER }],
    });

    await expect(service.create({ phone: '+201000000006', fullName: 'X', password: 'a-secure-password' })).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('DriversService.listAll (Phase I-A, Chunk 6; operational fields — Control Tower milestone)', () => {
  const rows = [
    {
      id: 'driver-1',
      isOnline: true,
      isAvailable: false,
      verificationStatus: 'APPROVED',
      lastLocationAt: new Date('2026-10-03T10:00:00Z'),
      vehicleTypeId: 'vt-motorbike',
      vehicleType: { name: 'Motorbike' },
      user: { fullName: 'Ali Hassan', phone: '+201000000007' },
    },
    { id: 'driver-2', isOnline: false, isAvailable: true, verificationStatus: 'PENDING', vehicleType: null, user: { fullName: 'Sara', phone: '+201000000008' } },
  ];

  it('maps Driver+User into the flat AdminDriverView shape, with vehicle, the order the driver is on and R18 load / capacity (two batched lookups, never one per driver)', async () => {
    const driversRepository = { find: jest.fn(async () => rows) };
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ driver_id: 'driver-1', order_id: 'order-9', order_number: 'HT-100009', status: 'PICKED_UP' }])
        .mockResolvedValueOnce([
          { id: 'driver-1', active: 2, capacity: 2, last_seen_at: new Date('2026-10-03T10:05:00Z') },
          { id: 'driver-2', active: 0, capacity: 1, last_seen_at: null },
        ]),
    };
    const service = new DriversService(dataSource as any, driversRepository as any, {} as any);

    const result = await service.listAll();

    expect(dataSource.query).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      {
        id: 'driver-1',
        fullName: 'Ali Hassan',
        phone: '+201000000007',
        isOnline: true,
        isAvailable: false,
        verificationStatus: 'APPROVED',
        vehicleTypeName: 'Motorbike',
        vehicleTypeId: 'vt-motorbike',
        lastLocationAt: new Date('2026-10-03T10:00:00Z'),
        activeDelivery: { orderId: 'order-9', orderNumber: 'HT-100009', status: 'PICKED_UP' },
        commissionRateBasisPoints: null,
        activeCount: 2,
        capacity: 2,
        lastSeenAt: new Date('2026-10-03T10:05:00Z'),
        shiftStartedAt: null,
        acceptingNewOrders: true,
      },
      {
        id: 'driver-2',
        fullName: 'Sara',
        phone: '+201000000008',
        isOnline: false,
        isAvailable: true,
        verificationStatus: 'PENDING',
        vehicleTypeName: null,
        vehicleTypeId: null,
        lastLocationAt: null,
        activeDelivery: null,
        commissionRateBasisPoints: null,
        activeCount: 0,
        capacity: 1,
        lastSeenAt: null,
        shiftStartedAt: null,
        acceptingNewOrders: true,
      },
    ]);
  });

  it('approvedOnly narrows the query to APPROVED drivers (the dispatcher picker)', async () => {
    const driversRepository = { find: jest.fn(async () => []) };
    const dataSource = { query: jest.fn() };
    await new DriversService(dataSource as any, driversRepository as any, {} as any).listAll({ approvedOnly: true });
    expect(driversRepository.find).toHaveBeenCalledWith(expect.objectContaining({ where: { verificationStatus: 'APPROVED' } }));
    expect(dataSource.query).not.toHaveBeenCalled(); // nothing to look up for zero drivers
  });
});

describe('DriversService.setVerificationStatus (Driver Core + Dispatch Foundation milestone)', () => {
  function buildVerificationHarness(existing: any) {
    const driverRows = new Map(existing ? [[existing.id, existing]] : []);
    const driversRepository = {
      findOne: jest.fn(async ({ where: { id } }: any) => driverRows.get(id) ?? null),
      findOneOrFail: jest.fn(async ({ where: { id } }: any) => {
        const row = driverRows.get(id);
        if (!row) throw new Error('not found');
        return row;
      }),
      // column-targeted UPDATE: mutates only the given columns of the stored row
      update: jest.fn(async ({ id }: any, partial: any) => {
        driverRows.set(id, { ...driverRows.get(id), ...partial });
      }),
      save: jest.fn(),
    };
    return { service: new DriversService({} as any, driversRepository as any, {} as any), driversRepository, driverRows };
  }

  it('moves a PENDING driver to APPROVED — the previously-missing writer DriverRankingService requires', async () => {
    const { service, driverRows } = buildVerificationHarness({ id: 'driver-1', verificationStatus: 'PENDING', commissionRateBasisPoints: 0 });

    const result = await service.setVerificationStatus('driver-1', 'APPROVED');

    expect(result.verificationStatus).toBe('APPROVED');
    expect(driverRows.get('driver-1').verificationStatus).toBe('APPROVED');
  });

  it('writes ONLY verification_status (never a whole-row save that could resurrect a stale is_available)', async () => {
    const { service, driversRepository } = buildVerificationHarness({ id: 'driver-1', verificationStatus: 'PENDING', isAvailable: true, commissionRateBasisPoints: 1000 });

    await service.setVerificationStatus('driver-1', 'APPROVED');

    expect(driversRepository.update).toHaveBeenCalledWith({ id: 'driver-1' }, { verificationStatus: 'APPROVED' });
    expect(driversRepository.save).not.toHaveBeenCalled();
  });

  it('refuses approval without an explicit commission rate', async () => {
    const { service, driversRepository } = buildVerificationHarness({ id: 'driver-1', verificationStatus: 'PENDING', commissionRateBasisPoints: null });
    await expect(service.setVerificationStatus('driver-1', 'APPROVED')).rejects.toMatchObject({ response: { details: { code: 'DRIVER_COMMISSION_REQUIRED' } } });
    expect(driversRepository.update).not.toHaveBeenCalled();
  });

  it('can also REJECT a driver', async () => {
    const { service } = buildVerificationHarness({ id: 'driver-1', verificationStatus: 'PENDING' });

    const result = await service.setVerificationStatus('driver-1', 'REJECTED');

    expect(result.verificationStatus).toBe('REJECTED');
  });

  it('is idempotent: setting the same status twice leaves the driver in that one state, no error', async () => {
    const { service } = buildVerificationHarness({ id: 'driver-1', verificationStatus: 'APPROVED', commissionRateBasisPoints: 0 });

    await expect(service.setVerificationStatus('driver-1', 'APPROVED')).resolves.toMatchObject({
      verificationStatus: 'APPROVED',
    });
  });

  it('throws NotFoundException for an unknown driver id', async () => {
    const { service } = buildVerificationHarness(null);

    await expect(service.setVerificationStatus('does-not-exist', 'APPROVED')).rejects.toThrow(NotFoundException);
  });
});

describe('DriversService.setVehicleType (Operational Completion milestone)', () => {
  function harness(opts: { driver?: any; vehicleType?: any }) {
    const driversRepository = {
      findOne: jest.fn(async () => opts.driver ?? null),
      update: jest.fn(async () => undefined),
      manager: { query: jest.fn(async () => []) },
      save: jest.fn(),
      find: jest.fn(async () => (opts.driver ? [{ ...opts.driver, user: { fullName: 'D', phone: '+20' } }] : [])),
    };
    const vehicleTypesService = { findById: jest.fn(async () => opts.vehicleType ?? null) };
    const dataSource = { query: jest.fn(async () => []) };
    const service = new DriversService(dataSource as any, driversRepository as any, vehicleTypesService as any);
    return { service, driversRepository, vehicleTypesService };
  }

  it('sets an ACTIVE catalog type, writing ONLY vehicle_type_id (never a whole-row save)', async () => {
    const { service, driversRepository } = harness({ driver: { id: 'd1' }, vehicleType: { id: 'vt1', isActive: true } });
    await service.setVehicleType('d1', 'vt1');
    expect(driversRepository.update).toHaveBeenCalledWith({ id: 'd1' }, { vehicleTypeId: 'vt1' });
    expect(driversRepository.save).not.toHaveBeenCalled();
  });

  it('clears the type with null, without consulting the catalog', async () => {
    const { service, driversRepository, vehicleTypesService } = harness({ driver: { id: 'd1', vehicleTypeId: 'vt1' } });
    await service.setVehicleType('d1', null);
    expect(vehicleTypesService.findById).not.toHaveBeenCalled();
    expect(driversRepository.update).toHaveBeenCalledWith({ id: 'd1' }, { vehicleTypeId: null });
  });

  it('refuses an unknown type (VEHICLE_TYPE_NOT_FOUND) and an inactive one (VEHICLE_TYPE_INACTIVE) — nothing written', async () => {
    const unknown = harness({ driver: { id: 'd1' } });
    await expect(unknown.service.setVehicleType('d1', 'nope')).rejects.toMatchObject({ response: { details: { code: 'VEHICLE_TYPE_NOT_FOUND' } } });
    expect(unknown.driversRepository.update).not.toHaveBeenCalled();
    const inactive = harness({ driver: { id: 'd1' }, vehicleType: { id: 'vt1', isActive: false } });
    await expect(inactive.service.setVehicleType('d1', 'vt1')).rejects.toMatchObject({ response: { details: { code: 'VEHICLE_TYPE_INACTIVE' } } });
    expect(inactive.driversRepository.update).not.toHaveBeenCalled();
  });

  it('404s for an unknown driver', async () => {
    const { service } = harness({ vehicleType: { id: 'vt1', isActive: true } });
    await expect(service.setVehicleType('missing', 'vt1')).rejects.toThrow(NotFoundException);
  });
});
