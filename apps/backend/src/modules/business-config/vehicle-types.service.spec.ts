import { NotFoundException } from '@nestjs/common';
import { VehicleTypesService } from './vehicle-types.service';

function buildMockRepo(initial: Array<any> = []) {
  const rows = [...initial];
  return {
    find: jest.fn(async ({ where }: { where?: { isActive?: boolean } } = {}) => {
      if (where?.isActive === undefined) return [...rows];
      return rows.filter((r) => r.isActive === where.isActive);
    }),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null),
    create: jest.fn((data: any) => ({ id: `new-${rows.length}`, isActive: true, ...data })),
    save: jest.fn(async (row: any) => {
      const index = rows.findIndex((r) => r.id === row.id);
      if (index >= 0) rows[index] = row;
      else rows.push(row);
      return row;
    }),
  };
}

describe('VehicleTypesService', () => {
  it('list defaults to active-only', async () => {
    const repo = buildMockRepo([
      { id: '1', name: 'Motorcycle', isActive: true },
      { id: '2', name: 'Bicycle (retired)', isActive: false },
    ]);
    const service = new VehicleTypesService(repo as any);
    const result = await service.list();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Motorcycle');
  });

  it('list(true) includes inactive rows', async () => {
    const repo = buildMockRepo([
      { id: '1', name: 'Motorcycle', isActive: true },
      { id: '2', name: 'Bicycle (retired)', isActive: false },
    ]);
    const service = new VehicleTypesService(repo as any);
    const result = await service.list(true);
    expect(result).toHaveLength(2);
  });

  it('create saves a new vehicle type', async () => {
    const repo = buildMockRepo();
    const service = new VehicleTypesService(repo as any);
    const created = await service.create({ name: 'Car', maxActiveDeliveries: 5 });
    expect(created.name).toBe('Car');
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('update throws NotFoundException for an unknown id', async () => {
    const service = new VehicleTypesService(buildMockRepo() as any);
    await expect(service.update('missing-id', { name: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('update merges the provided fields onto the existing row', async () => {
    const repo = buildMockRepo([{ id: '1', name: 'Motorcycle', maxActiveDeliveries: 3, isActive: true }]);
    const service = new VehicleTypesService(repo as any);
    const updated = await service.update('1', { maxActiveDeliveries: 4 });
    expect(updated.maxActiveDeliveries).toBe(4);
    expect(updated.name).toBe('Motorcycle'); // untouched field preserved
  });
});
