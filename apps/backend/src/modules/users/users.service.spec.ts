import { UsersService } from './users.service';
import { Role } from '../../common/enums/role.enum';

function buildHarness(users: any[]) {
  const usersRepository = {
    // `opts.where.role` is a real TypeORM `FindOperator` (from `In(...)`) — `.value` is its own
    // PUBLIC getter (not a private/internal field), the stable way to inspect what it was built with.
    find: jest.fn(async (opts: any) => users.filter((u) => opts.where.role.value.includes(u.role))),
  };
  const service = new UsersService(usersRepository as any);
  return { service, usersRepository };
}

describe('UsersService.listAdmins (M3b, G-08)', () => {
  it('returns only ADMIN and SUPER_ADMIN users — never customers, drivers, or vendor staff', async () => {
    const { service } = buildHarness([
      { id: 'c1', role: Role.CUSTOMER },
      { id: 'd1', role: Role.DRIVER },
      { id: 'v1', role: Role.VENDOR_MANAGER },
      { id: 'a1', role: Role.ADMIN },
      { id: 's1', role: Role.SUPER_ADMIN },
    ]);

    const result = await service.listAdmins();

    expect(result.map((u) => u.id).sort()).toEqual(['a1', 's1']);
  });

  it('queries by role using the real TypeORM In() operator against exactly [ADMIN, SUPER_ADMIN]', async () => {
    const { service, usersRepository } = buildHarness([]);

    await service.listAdmins();

    const callArgs = usersRepository.find.mock.calls[0][0];
    expect(callArgs.where.role.value).toEqual([Role.ADMIN, Role.SUPER_ADMIN]);
    expect(callArgs.order).toEqual({ createdAt: 'ASC' });
  });
});
