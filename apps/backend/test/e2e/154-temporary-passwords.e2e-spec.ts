/**
 * Owner decision 2026-11-23: a password set by Hatly staff is TEMPORARY — for customers (new: reset from the admin panel), drivers and
 * staff. After signing in with it, the app/panel must get a new password first: the server refuses everything else
 * (PASSWORD_CHANGE_REQUIRED) until the person changes it; then the same session works normally.
 */
import { bootWorld, World } from './support/world';
import { Actor, Scenario } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — temporary passwords (customer, driver, staff)', () => {
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

  const code = (r: { body: any }) => r.body?.error?.details?.code;

  it('customer: reset needs Manage customers; temp sign-in must change first; then everything works and the flag is gone', async () => {
    const c = await s.customer('Temp Customer');
    const viewer = await s.admin([Permission.VIEW_CUSTOMERS], 'Viewer Only');
    const manager = await s.admin([Permission.VIEW_CUSTOMERS, Permission.MANAGE_CUSTOMERS], 'Customer Manager');
    const reset = (token: string, newPassword: string) => world.api('post', `/admin/customers/${c.id}/reset-password`, { token, body: { newPassword } });

    expect((await reset(viewer.accessToken, 'Temp-Pass-123')).status).toBe(403);
    expect((await reset(manager.accessToken, 'Temp-Pass-123')).status).toBe(204);
    expect((await world.api('post', `/admin/customers/${sa.id}/reset-password`, { token: manager.accessToken, body: { newPassword: 'Temp-Pass-123' } })).status).toBe(404); // not a customer

    const login = await world.api('post', '/auth/customer/password/login', { body: { phone: c.phone, password: 'Temp-Pass-123' } });
    expect(login.status).toBe(200);
    expect(login.body.data.mustChangePassword).toBe(true);
    const token = login.body.data.accessToken as string;

    const blocked = await world.api('get', '/cart', { token });
    expect(blocked.status).toBe(403);
    expect(code(blocked)).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await world.api('get', '/auth/customer/me', { token })).body.data.mustChangePassword).toBe(true);

    expect(code(await world.api('patch', '/auth/customer/password', { token, body: { currentPassword: 'Temp-Pass-123', password: 'Temp-Pass-123' } }))).toBe('PASSWORD_UNCHANGED');
    expect((await world.api('patch', '/auth/customer/password', { token, body: { currentPassword: 'Temp-Pass-123', password: 'My-Own-Pass-9' } })).status).toBe(200);

    expect((await world.api('get', '/cart', { token })).status).toBe(200); // the same session now works
    const again = await world.api('post', '/auth/customer/password/login', { body: { phone: c.phone, password: 'My-Own-Pass-9' } });
    expect(again.status).toBe(200);
    expect(again.body.data.mustChangePassword).toBeUndefined();
  });

  it('driver: temp sign-in is locked to the password change; the new driver endpoint changes it', async () => {
    const area = await s.serviceArea({ name: 'Temp Area' });
    const d = await s.driver({ lat: area.lat, lng: area.lng, fullName: 'Temp Driver' });
    const [{ phone }] = await world.ds.query(`SELECT phone FROM users WHERE id = $1`, [d.id]);
    expect((await world.api('post', `/admin/drivers/${d.driverId}/reset-password`, { token: sa.accessToken, body: { newPassword: 'Temp-Pass-123' } })).status).toBe(204);

    const login = await world.api('post', '/auth/driver/login', { body: { phone, password: 'Temp-Pass-123' } });
    expect(login.body.data.mustChangePassword).toBe(true);
    const token = login.body.data.accessToken as string;
    expect(code(await world.api('get', '/driver/shift', { token }))).toBe('PASSWORD_CHANGE_REQUIRED');

    expect(code(await world.api('post', '/auth/driver/password', { token, body: { currentPassword: 'wrong-one', newPassword: 'Driver-Own-9' } }))).toBe('CURRENT_PASSWORD_INVALID');
    expect((await world.api('post', '/auth/driver/password', { token, body: { currentPassword: 'Temp-Pass-123', newPassword: 'Driver-Own-9' } })).status).toBe(200);
    expect((await world.api('get', '/driver/shift', { token })).status).toBe(200);
    expect((await world.api('post', '/auth/driver/login', { body: { phone, password: 'Driver-Own-9' } })).status).toBe(200);
  });

  it('staff: a reset by a manager is temporary too; the panel session says so; the own-password change clears it', async () => {
    const presets = (await world.api('get', '/admin/staff', { token: sa.accessToken })).body.meta.presets as Array<{ key: string; permissions: Permission[] }>;
    const team = await s.admin(presets.find((p) => p.key === 'OPS_TEAM')!.permissions, 'Temp Staff');
    expect((await world.api('post', `/admin/staff/${team.id}/reset-password`, { token: sa.accessToken, body: { newPassword: 'Temp-Staff-Pass-1' } })).status).toBeLessThan(300);

    const login = await world.api('post', '/auth/password/login', { body: { phone: team.phone, password: 'Temp-Staff-Pass-1' } });
    expect(login.body.data.mustChangePassword).toBe(true);
    const token = login.body.data.accessToken as string;
    expect(code(await world.api('get', '/admin/orders', { token }))).toBe('PASSWORD_CHANGE_REQUIRED');

    expect((await world.api('post', '/auth/dashboard/password', { token, body: { currentPassword: 'Temp-Staff-Pass-1', newPassword: 'Staff-Own-Pass-22' } })).status).toBe(200);
    expect((await world.api('get', '/admin/orders', { token })).status).toBe(200);
    const [{ must_change_password }] = await world.ds.query(`SELECT must_change_password FROM users WHERE id = $1`, [team.id]);
    expect(must_change_password).toBe(false);
  });
});
