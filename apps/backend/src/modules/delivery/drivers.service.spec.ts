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
  const service = new DriversService(dataSource as any, driversRepository as any);
  return { service, users, driverRows };
}

describe('DriversService', () => {
  it('creates a DRIVER user and its Driver profile row', async () => {
    const { service, users, driverRows } = buildHarness();

    const driver = await service.create({ phone: '+201000000005', fullName: 'New Driver', password: 'a-secure-password' });

    expect(users.get('+201000000005').role).toBe(Role.DRIVER);
    expect(driverRows).toHaveLength(1);
    expect(driver.userId).toBe(users.get('+201000000005').id);
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

describe('DriversService.listAll (Phase I-A, Chunk 6)', () => {
  it('maps Driver+User into the flat AdminDriverView shape', async () => {
    const driversRepository = {
      find: jest.fn(async () => [
        {
          id: 'driver-1',
          isOnline: true,
          isAvailable: false,
          verificationStatus: 'APPROVED',
          user: { fullName: 'Ali Hassan', phone: '+201000000007' },
        },
      ]),
    };
    const service = new DriversService({} as any, driversRepository as any);

    const result = await service.listAll();

    expect(result).toEqual([
      {
        id: 'driver-1',
        fullName: 'Ali Hassan',
        phone: '+201000000007',
        isOnline: true,
        isAvailable: false,
        verificationStatus: 'APPROVED',
      },
    ]);
  });
});

describe('DriversService.setVerificationStatus (Driver Core + Dispatch Foundation milestone)', () => {
  function buildVerificationHarness(existing: any) {
    const driverRows = new Map(existing ? [[existing.id, existing]] : []);
    const driversRepository = {
      findOne: jest.fn(async ({ where: { id } }: any) => driverRows.get(id) ?? null),
      save: jest.fn(async (driver: any) => {
        driverRows.set(driver.id, driver);
        return driver;
      }),
    };
    return { service: new DriversService({} as any, driversRepository as any), driversRepository, driverRows };
  }

  it('moves a PENDING driver to APPROVED — the previously-missing writer DriverRankingService requires', async () => {
    const { service, driverRows } = buildVerificationHarness({ id: 'driver-1', verificationStatus: 'PENDING' });

    const result = await service.setVerificationStatus('driver-1', 'APPROVED');

    expect(result.verificationStatus).toBe('APPROVED');
    expect(driverRows.get('driver-1').verificationStatus).toBe('APPROVED');
  });

  it('can also REJECT a driver', async () => {
    const { service } = buildVerificationHarness({ id: 'driver-1', verificationStatus: 'PENDING' });

    const result = await service.setVerificationStatus('driver-1', 'REJECTED');

    expect(result.verificationStatus).toBe('REJECTED');
  });

  it('is idempotent: setting the same status twice leaves the driver in that one state, no error', async () => {
    const { service } = buildVerificationHarness({ id: 'driver-1', verificationStatus: 'APPROVED' });

    await expect(service.setVerificationStatus('driver-1', 'APPROVED')).resolves.toMatchObject({
      verificationStatus: 'APPROVED',
    });
  });

  it('throws NotFoundException for an unknown driver id', async () => {
    const { service } = buildVerificationHarness(null);

    await expect(service.setVerificationStatus('does-not-exist', 'APPROVED')).rejects.toThrow(NotFoundException);
  });
});
