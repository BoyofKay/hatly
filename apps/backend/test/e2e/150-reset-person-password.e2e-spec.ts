/**
 * Owner request 2026-11-22: a driver (or store staff member) who forgot their password gets a temporary one from the admin panel.
 * Supervisors may do it for drivers; the operations team may not. The old password and every open session stop working.
 */
import { bootWorld, World } from './support/world';
import { Actor, Scenario } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — reset a driver password from the admin panel', () => {
  let world: World;
  let s: Scenario;
  let sa: Actor;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    sa = await s.superAdmin();
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('supervisor resets; the new password works, the old one and the old session do not; the team cannot; too short is refused', async () => {
    const area = await s.serviceArea({ name: 'Reset Area' });
    const d = await s.driver({ lat: area.lat, lng: area.lng, fullName: 'Forgetful Driver' });
    const [{ phone }] = await world.ds.query(`SELECT phone FROM users WHERE id = $1`, [d.id]);
    const presets = (await world.api('get', '/admin/staff', { token: sa.accessToken })).body.meta.presets as Array<{ key: string; permissions: Permission[] }>;
    const supervisor = await s.admin(presets.find((p) => p.key === 'OPS_SUPERVISOR')!.permissions, 'Reset Supervisor');
    const team = await s.admin(presets.find((p) => p.key === 'OPS_TEAM')!.permissions, 'Reset Team');
    const reset = (token: string, newPassword: string) => world.api('post', `/admin/drivers/${d.driverId}/reset-password`, { token, body: { newPassword } });

    expect((await reset(team.accessToken, 'Temp-Pass-123')).status).toBe(403);
    expect((await reset(supervisor.accessToken, 'short')).status).toBe(400);
    expect((await reset(supervisor.accessToken, 'Temp-Pass-123')).status).toBe(204);

    expect((await world.api('post', '/auth/driver/login', { body: { phone, password: 'Temp-Pass-123' } })).status).toBe(200);
    const old = await world.api('post', '/auth/driver/login', { body: { phone, password: 'definitely-not-it-anymore' } });
    expect(old.status).toBe(401);
    // the session from before the reset is over
    expect((await world.api('post', '/auth/refresh', { body: { refreshToken: d.refreshToken } })).status).toBe(401);
  });
});
