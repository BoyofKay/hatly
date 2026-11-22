/**
 * Owner decision 2026-11-22: a store manager may promote one of their OWN operators to manager from the store dashboard (Hatly admins can
 * too, from Vendor Staff). Not themselves, not an operator who also works at another manager's branch, and an operator cannot promote.
 */
import { bootWorld, World } from './support/world';
import { Scenario, expectData } from './support/actors';
import { Role } from '../../src/common/enums/role.enum';

describe('E2E — store manager promotes an operator', () => {
  let world: World;
  let s: Scenario;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('a manager promotes their own operator; the promoted person signs in as manager; nobody promotes themselves; operators cannot promote', async () => {
    const area = await s.serviceArea({ name: 'Promote Area' });
    const vendor = await s.vendor({ serviceAreaId: area.id, lat: area.lat, lng: area.lng });
    const m = vendor.manager.accessToken;
    const phone = '+201077770001';
    const created = expectData<any>(await world.api('post', '/vendor/team/members', { token: m, body: { fullName: 'Shift Operator', phone, password: 'Operator-Pass-1', branchId: vendor.branchId } }), 201);
    const operatorUserId = (await world.ds.query(`SELECT id FROM users WHERE phone = $1`, [phone]))[0].id;
    expect(created).toBeTruthy();

    const operator = await s.login('/auth/password/login', { phone, fullName: 'Shift Operator', role: Role.VENDOR }, 'Operator-Pass-1');
    expect((await world.api('post', `/vendor/team/members/${vendor.manager.id}/promote`, { token: operator.accessToken })).status).toBe(403); // operators cannot
    expect((await world.api('post', `/vendor/team/members/${vendor.manager.id}/promote`, { token: m })).status).toBe(403); // not themselves

    const res = await world.api('post', `/vendor/team/members/${operatorUserId}/promote`, { token: m });
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('VENDOR_MANAGER');
    const again = await s.login('/auth/password/login', { phone, fullName: 'Shift Operator', role: Role.VENDOR_MANAGER }, 'Operator-Pass-1');
    expect(JSON.parse(Buffer.from(again.accessToken.split('.')[1], 'base64url').toString()).role).toBe('VENDOR_MANAGER');
    const [audit] = await world.ds.query(`SELECT action FROM admin_audit_logs WHERE action = 'vendor_staff.promoted' AND target_id = $1`, [operatorUserId]);
    expect(audit).toBeTruthy();
  });
});
