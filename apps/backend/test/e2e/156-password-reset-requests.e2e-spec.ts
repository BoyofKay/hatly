/**
 * Owner decision 2026-11-23: "Forgot password?" is request-based for every user type. Someone above the requester issues a temporary
 * password on the request (staff: only a higher level; customers / drivers / store staff: the matching permission); the requester types
 * it with a new password on the same screen. The old password keeps working until then. 60-minute expiry, 5 wrong tries.
 */
import { bootWorld, World } from './support/world';
import { Actor, Scenario, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — request-based password reset (all user types)', () => {
  let world: World;
  let s: Scenario;
  let sa: Actor;
  let presets: Array<{ key: string; permissions: Permission[] }>;
  const call = (method: 'get' | 'post', token: string | undefined, path: string, body?: unknown) => world.api(method, path, { token, body });
  const code = (r: any) => r.body?.error?.details?.code;
  const requestFor = async (token: string, userId: string) =>
    expectData<any[]>(await call('get', token, '/admin/password-reset-requests')).find((r) => r.userId === userId);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    sa = await s.superAdmin();
    presets = (await call('get', sa.accessToken, '/admin/staff')).body.meta.presets;
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('customer: request → issue → wrong tries count down → the right one with a new password; old password works until then', async () => {
    const c = await s.customer('Forgetful Customer');
    const same = await call('post', undefined, '/auth/password-reset/request', { phone: c.phone });
    const unknown = await call('post', undefined, '/auth/password-reset/request', { phone: '+201088888888' });
    expect(same.status).toBe(202);
    expect(unknown.body.message).toBe(same.body.message);

    const viewer = await s.admin([Permission.VIEW_ORDERS], 'No Reset Rights');
    expect((await call('get', viewer.accessToken, '/admin/password-reset-requests')).status).toBe(403);
    const driversOnly = await s.admin([Permission.MANAGE_DRIVERS], 'Drivers Only');
    const req = await requestFor(sa.accessToken, c.id);
    expect(req).toMatchObject({ kind: 'CUSTOMER', canIssue: true, tempIssuedAt: null });
    expect((await call('post', driversOnly.accessToken, `/admin/password-reset-requests/${req.id}/issue`)).status).toBe(403);

    const manager = await s.admin([Permission.MANAGE_CUSTOMERS], 'Customer Desk');
    expect(expectData<any[]>(await call('get', manager.accessToken, '/admin/password-reset-requests?actionable=true')).some((r) => r.userId === c.id)).toBe(true);
    const issued = expectData<any>(await call('post', manager.accessToken, `/admin/password-reset-requests/${req.id}/issue`), 201);
    expect(issued.tempPassword).toMatch(/^[a-z]{4}-\d{4}[a-z]$/);

    // the old password still works (Cancel = sign in as usual)
    expect((await call('post', undefined, '/auth/customer/password/login', { phone: c.phone, password: c.password })).status).toBe(200);
    // not before a temporary password exists for a stranger's phone
    expect(code(await call('post', undefined, '/auth/password-reset/complete', { phone: '+201077777777', tempPassword: 'x', newPassword: 'whatever-1' }))).toBe('TEMP_PASSWORD_INVALID');

    const wrong = await call('post', undefined, '/auth/password-reset/complete', { phone: c.phone, tempPassword: 'nope-0000a', newPassword: 'Brand-New-1' });
    expect(code(wrong)).toBe('TEMP_PASSWORD_INVALID');
    expect(wrong.body.error.details.attemptsLeft).toBe(4);
    expect(code(await call('post', undefined, '/auth/password-reset/complete', { phone: c.phone, tempPassword: issued.tempPassword, newPassword: 'short' }))).toBe('WEAK_PASSWORD');
    expect((await call('post', undefined, '/auth/password-reset/complete', { phone: c.phone, tempPassword: issued.tempPassword, newPassword: 'Brand-New-1' })).status).toBe(200);

    expect((await call('post', undefined, '/auth/customer/password/login', { phone: c.phone, password: c.password })).status).toBe(401);
    expect((await call('post', undefined, '/auth/customer/password/login', { phone: c.phone, password: 'Brand-New-1' })).status).toBe(200);
    expect(await requestFor(sa.accessToken, c.id)).toBeUndefined();
    // the old session is over
    expect((await call('post', undefined, '/auth/refresh', { refreshToken: c.refreshToken })).status).toBe(401);
  });

  it('expires after its time; 5 wrong tries close the request', async () => {
    const d = await s.driver({ lat: 30.42, lng: 31.56, fullName: 'Locked Driver' });
    const [{ phone }] = await world.ds.query(`SELECT phone FROM users WHERE id = $1`, [d.id]);
    await call('post', undefined, '/auth/password-reset/request', { phone });
    let req = await requestFor(sa.accessToken, d.id);
    expect(req.kind).toBe('DRIVER');
    let issued = expectData<any>(await call('post', sa.accessToken, `/admin/password-reset-requests/${req.id}/issue`), 201);
    await world.ds.query(`UPDATE password_reset_requests SET temp_expires_at = now() - interval '1 minute' WHERE id = $1`, [req.id]);
    expect(code(await call('post', undefined, '/auth/password-reset/complete', { phone, tempPassword: issued.tempPassword, newPassword: 'Driver-New-1' }))).toBe('TEMP_PASSWORD_EXPIRED');
    expect(await requestFor(sa.accessToken, d.id)).toBeUndefined();

    await call('post', undefined, '/auth/password-reset/request', { phone });
    req = await requestFor(sa.accessToken, d.id);
    issued = expectData<any>(await call('post', sa.accessToken, `/admin/password-reset-requests/${req.id}/issue`), 201);
    for (let i = 1; i <= 4; i++) expect(code(await call('post', undefined, '/auth/password-reset/complete', { phone, tempPassword: 'bad-0000x', newPassword: 'Driver-New-1' }))).toBe('TEMP_PASSWORD_INVALID');
    expect(code(await call('post', undefined, '/auth/password-reset/complete', { phone, tempPassword: 'bad-0000x', newPassword: 'Driver-New-1' }))).toBe('TEMP_PASSWORD_LOCKED');
    expect(code(await call('post', undefined, '/auth/password-reset/complete', { phone, tempPassword: issued.tempPassword, newPassword: 'Driver-New-1' }))).toBe('TEMP_PASSWORD_INVALID');
  });

  it('Hatly staff: only a higher level issues; same level or above cannot (and cannot even see it); the super admin has nobody above', async () => {
    const admin = await s.admin(presets.find((p) => p.key === 'ADMIN')?.permissions ?? [Permission.MANAGE_STAFF_ACCOUNTS], 'Level Admin');
    await world.ds.query(`UPDATE users SET staff_level = 'ADMIN' WHERE id = $1`, [admin.id]);
    const supervisor = await s.admin(presets.find((p) => p.key === 'OPS_SUPERVISOR')!.permissions, 'Level Supervisor');
    await world.ds.query(`UPDATE users SET staff_level = 'OPS_SUPERVISOR' WHERE id = $1`, [supervisor.id]);
    const supervisor2 = await s.admin(presets.find((p) => p.key === 'OPS_SUPERVISOR')!.permissions, 'Other Supervisor');
    await world.ds.query(`UPDATE users SET staff_level = 'OPS_SUPERVISOR' WHERE id = $1`, [supervisor2.id]);

    await call('post', undefined, '/auth/password-reset/request', { phone: supervisor.phone });
    const req = await requestFor(sa.accessToken, supervisor.id);
    expect(req.kind).toBe('HATLY_STAFF');
    // same level: invisible and refused
    expect(await requestFor(supervisor2.accessToken, supervisor.id)).toBeUndefined();
    expect(code(await call('post', supervisor2.accessToken, `/admin/password-reset-requests/${req.id}/issue`))).toBe('RESET_NOT_ALLOWED');
    // a higher level: allowed; the staff password rule applies to the new password
    const issued = expectData<any>(await call('post', admin.accessToken, `/admin/password-reset-requests/${req.id}/issue`), 201);
    expect(code(await call('post', undefined, '/auth/password-reset/complete', { phone: supervisor.phone, tempPassword: issued.tempPassword, newPassword: 'onlyletters' }))).toBe('WEAK_PASSWORD');
    expect((await call('post', undefined, '/auth/password-reset/complete', { phone: supervisor.phone, tempPassword: issued.tempPassword, newPassword: 'Supervisor-New-22' })).status).toBe(200);

    // the admin's own request: the supervisor (below) cannot; the super admin can
    await call('post', undefined, '/auth/password-reset/request', { phone: admin.phone });
    const adminReq = await requestFor(sa.accessToken, admin.id);
    expect(code(await call('post', supervisor2.accessToken, `/admin/password-reset-requests/${adminReq.id}/issue`))).toBe('RESET_NOT_ALLOWED');
    expect((await call('post', sa.accessToken, `/admin/password-reset-requests/${adminReq.id}/dismiss`)).status).toBe(204);

    // the super admin: nobody above
    const [{ phone: saPhone }] = await world.ds.query(`SELECT phone FROM users WHERE id = $1`, [sa.id]);
    await call('post', undefined, '/auth/password-reset/request', { phone: saPhone });
    const [saReq] = await world.ds.query(`SELECT id FROM password_reset_requests WHERE user_id = $1 AND resolved_at IS NULL`, [sa.id]);
    expect(code(await call('post', sa.accessToken, `/admin/password-reset-requests/${saReq.id}/issue`))).toBe('RESET_NOT_ALLOWED');
  });
});
