/**
 * Driver loans (owner decision 2026-11-22): the operations supervisor (not the team) lends money to a driver; an optional maximum caps what
 * one person may owe (unset = no cap); a repayment can never exceed what is owed; the driver's open loans show on his shift closing.
 */
import { bootWorld, World } from './support/world';
import { Actor, Scenario, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — driver loans', () => {
  let world: World;
  let s: Scenario;
  let sa: Actor;
  let supervisor: Actor;
  let team: Actor;
  let driverUserId: string;
  let driverId: string;
  const api = (method: 'get' | 'post' | 'put' | 'delete', path: string, token: string, body?: unknown) => world.api(method, path, { token, body });
  const issue = (token: string, amountMinor: number) => api('post', '/admin/employee-loans', token, { employeeUserId: driverUserId, borrowedAmountMinor: amountMinor, issuedAt: new Date().toISOString(), reason: 'Pay the restaurant' });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    sa = await s.superAdmin();
    const area = await s.serviceArea({ name: 'Loan Area' });
    const d = await s.driver({ lat: area.lat, lng: area.lng, fullName: 'Loan Driver' });
    driverUserId = d.id;
    driverId = d.driverId;
    const presets = (await api('get', '/admin/staff', sa.accessToken)).body.meta.presets as Array<{ key: string; permissions: Permission[] }>;
    supervisor = await s.admin(presets.find((p) => p.key === 'OPS_SUPERVISOR')!.permissions, 'Loan Supervisor');
    team = await s.admin(presets.find((p) => p.key === 'OPS_TEAM')!.permissions, 'Loan Team');
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('the supervisor can lend and sees drivers by name; the operations team cannot', async () => {
    const people = expectData<any[]>(await api('get', '/admin/employee-loans/people', supervisor.accessToken));
    expect(people.find((p) => p.userId === driverUserId)).toEqual(expect.objectContaining({ fullName: 'Loan Driver', outstandingMinor: 0 }));
    expect((await api('get', '/admin/employee-loans/people', team.accessToken)).status).toBe(403);
    expect((await issue(team.accessToken, 10000)).status).toBe(403);
    expect((await issue(supervisor.accessToken, 30000)).status).toBe(201);
  });

  it('with no maximum set there is no cap; with a maximum, a loan above it is refused with the amounts', async () => {
    expect((await issue(supervisor.accessToken, 100000)).status).toBe(201); // owes 1,300 EGP now
    expectData(await api('put', '/admin/business-config/EMPLOYEE_LOAN_MAX_OUTSTANDING_MINOR', sa.accessToken, { value: 150000 }));
    const refused = await issue(supervisor.accessToken, 30000); // would be 1,600 > 1,500
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain('LOAN_ABOVE_MAXIMUM');
    expect((await issue(supervisor.accessToken, 20000)).status).toBe(201); // exactly 1,500
    expectData(await api('delete', '/admin/business-config/EMPLOYEE_LOAN_MAX_OUTSTANDING_MINOR', sa.accessToken));
  });

  it('a repayment above what is owed is refused; the shift closing shows the open loans', async () => {
    const loans = expectData<any[]>(await api('get', `/admin/employee-loans/employee/${driverUserId}`, supervisor.accessToken));
    const first = loans.find((l) => Number(l.borrowedAmountMinor) === 30000);
    const tooMuch = await api('post', `/admin/employee-loans/${first.id}/repayments`, supervisor.accessToken, { amountMinor: 30001, repaidAt: new Date().toISOString() });
    expect(tooMuch.status).toBe(400);
    expect((await api('post', `/admin/employee-loans/${first.id}/repayments`, supervisor.accessToken, { amountMinor: 30000, repaidAt: new Date().toISOString() })).status).toBe(201);
    const preview = expectData<any>(await api('get', `/admin/settlement/drivers/${driverId}/close-preview`, supervisor.accessToken));
    expect(preview.loans.outstandingMinor).toBe(120000);
    expect(preview.loans.items).toHaveLength(2);
  });
});
