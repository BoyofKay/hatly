/**
 * Staff accounts and hierarchy (2026-11-21): SUPER_ADMIN > ADMIN > OPS_SUPERVISOR > OPS_TEAM, over real HTTP and a real database.
 * Covers: a super admin creates an admin with a preset; an admin with MANAGE_STAFF_ACCOUNTS creates a supervisor but never an admin;
 * a supervisor manages only the team and only with permissions it holds; nobody manages themselves or anyone at/above their level;
 * deactivate/delete end access at once; password reset; every staff member changes their own password.
 */
import { bootWorld, World } from './support/world';
import { Actor, Scenario, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — staff accounts and hierarchy', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let phoneSeq = 0;
  const phone = () => `+2010555${String(++phoneSeq).padStart(5, '0')}`;
  const STRONG = 'Strong-Pass-123';
  const api = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, token: string, body?: unknown) => world.api(method, path, { token, body });
  const signIn = async (p: string, password = STRONG) => world.api('post', '/auth/password/login', { body: { phone: p, password } });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    superAdmin = await s.superAdmin();
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  async function createAs(token: string, body: Record<string, unknown>) {
    return api('post', '/admin/staff', token, { password: STRONG, fullName: 'Staff Member', phone: phone(), ...body });
  }
  async function tokenFor(p: string): Promise<string> {
    return expectData<{ accessToken: string }>(await signIn(p)).accessToken;
  }

  it('the super admin creates an admin from the ADMIN_GENERAL preset; the new admin signs in and holds exactly the preset', async () => {
    const res = await createAs(superAdmin.accessToken, { fullName: 'General Admin', level: 'ADMIN', templateKey: 'ADMIN_GENERAL' });
    expect(res.status).toBe(201);
    const created = res.body.data;
    expect(created).toEqual(expect.objectContaining({ role: 'ADMIN', level: 'ADMIN', isActive: true, manageable: true }));
    expect(created.permissions).toContain(Permission.MANAGE_STAFF_ACCOUNTS);
    expect(created.permissions).not.toContain(Permission.MANAGE_BUSINESS_CONFIG);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash/);
    expect((await signIn(created.phone)).status).toBe(200);
  });

  it('refuses a weak password, a duplicate phone, and an unknown permission', async () => {
    expect((await createAs(superAdmin.accessToken, { level: 'OPS_TEAM', password: 'short1' })).status).toBe(400);
    expect((await createAs(superAdmin.accessToken, { level: 'OPS_TEAM', password: 'onlyletterspassword' })).status).toBe(400);
    const first = expectData<any>(await createAs(superAdmin.accessToken, { level: 'OPS_TEAM' }), 201);
    const dup = await createAs(superAdmin.accessToken, { level: 'OPS_TEAM', phone: first.phone });
    expect(dup.status).toBe(409);
    expect((await createAs(superAdmin.accessToken, { level: 'OPS_TEAM', permissions: ['NOT_A_PERMISSION'] })).status).toBe(400);
  });

  describe('an admin with MANAGE_STAFF_ACCOUNTS', () => {
    let admin: Actor;
    beforeAll(async () => {
      admin = await s.admin([Permission.MANAGE_STAFF_ACCOUNTS, Permission.VIEW_ORDERS, Permission.ASSIGN_REASSIGN_ORDERS], 'Staff Admin');
    });

    it('creates a supervisor with permissions it holds, but never another admin, and never beyond its own permissions', async () => {
      const ok = await createAs(admin.accessToken, { level: 'OPS_SUPERVISOR', permissions: [Permission.VIEW_ORDERS, Permission.MANAGE_STAFF_ACCOUNTS] });
      expect(ok.status).toBe(201);
      expect((await createAs(admin.accessToken, { level: 'ADMIN' })).status).toBe(403);
      const beyond = await createAs(admin.accessToken, { level: 'OPS_TEAM', permissions: [Permission.MANAGE_BUSINESS_CONFIG] });
      expect(beyond.status).toBe(403);
      expect(beyond.body.details?.code ?? beyond.body.error?.details?.code ?? JSON.stringify(beyond.body)).toMatch(/GRANT_EXCEEDS_YOUR_PERMISSIONS/);
    });

    it('lists itself and the staff below it — never the super admin — and reports which levels it may create', async () => {
      const res = await api('get', '/admin/staff', admin.accessToken);
      expect(res.status).toBe(200);
      const rows = res.body.data as any[];
      expect(rows.some((r) => r.id === superAdmin.id)).toBe(false);
      expect(rows.find((r) => r.id === admin.id)).toEqual(expect.objectContaining({ manageable: false }));
      expect(res.body.meta.creatableLevels).toEqual(['OPS_SUPERVISOR', 'OPS_TEAM']);
    });

    it('cannot edit itself, another admin, or the super admin', async () => {
      const peer = await s.admin([], 'Peer Admin');
      expect((await api('patch', `/admin/staff/${admin.id}`, admin.accessToken, { fullName: 'Me Promoted' })).status).toBe(403);
      expect((await api('patch', `/admin/staff/${peer.id}`, admin.accessToken, { fullName: 'Renamed' })).status).toBe(404);
      expect((await api('patch', `/admin/staff/${superAdmin.id}/deactivate`, admin.accessToken)).status).toBe(404);
      expect((await api('put', `/admin/staff/${admin.id}/permissions`, admin.accessToken, { permissions: [Permission.MANAGE_BUSINESS_CONFIG] })).status).toBe(403);
    });
  });

  describe('a supervisor', () => {
    let supervisorToken: string;
    let teamMember: any;
    beforeAll(async () => {
      const sup = expectData<any>(await createAs(superAdmin.accessToken, { level: 'OPS_SUPERVISOR', templateKey: 'OPS_SUPERVISOR' }), 201);
      supervisorToken = await tokenFor(sup.phone);
    });

    it('creates an operations team member from the OPS_TEAM preset, edits it, and resets its password', async () => {
      teamMember = expectData<any>(await createAs(supervisorToken, { level: 'OPS_TEAM', templateKey: 'OPS_TEAM' }), 201);
      expect(teamMember.level).toBe('OPS_TEAM');
      const edited = expectData<any>(await api('patch', `/admin/staff/${teamMember.id}`, supervisorToken, { fullName: 'Team Member Renamed' }));
      expect(edited.fullName).toBe('Team Member Renamed');
      expect((await api('patch', `/admin/staff/${teamMember.id}`, supervisorToken, { level: 'OPS_SUPERVISOR' })).status).toBe(403);
      expect((await api('post', `/admin/staff/${teamMember.id}/reset-password`, supervisorToken, { newPassword: 'Reset-Pass-456' })).status).toBe(201);
      expect((await signIn(teamMember.phone)).status).toBe(401);
      expect((await signIn(teamMember.phone, 'Reset-Pass-456')).status).toBe(200);
    });

    it('cannot create a supervisor or an admin', async () => {
      expect((await createAs(supervisorToken, { level: 'OPS_SUPERVISOR' })).status).toBe(403);
      expect((await createAs(supervisorToken, { level: 'ADMIN' })).status).toBe(403);
    });

    it('setting permissions never removes one the supervisor does not hold itself', async () => {
      // The super admin gives the team member something the supervisor does not have.
      expectData(await api('put', `/admin/staff/${teamMember.id}/permissions`, superAdmin.accessToken, { permissions: [Permission.VIEW_ORDERS, Permission.MANAGE_OFFERS] }));
      const after = expectData<any>(await api('put', `/admin/staff/${teamMember.id}/permissions`, supervisorToken, { permissions: [Permission.FLEET_VIEW] }));
      expect(after.permissions.sort()).toEqual([Permission.FLEET_VIEW, Permission.MANAGE_OFFERS].sort());
    });

    it('deactivating ends access at once; activating restores it; deleting removes the account and frees its phone', async () => {
      const memberToken = await tokenFor(teamMember.phone).catch(async () => (await signIn(teamMember.phone, 'Reset-Pass-456')).body.data.accessToken);
      expect((await api('get', '/admin/me/permissions', memberToken)).status).toBe(200);
      expectData(await api('patch', `/admin/staff/${teamMember.id}/deactivate`, supervisorToken));
      expect((await api('get', '/admin/me/permissions', memberToken)).status).toBe(401);
      expectData(await api('patch', `/admin/staff/${teamMember.id}/activate`, supervisorToken));
      // deleting is an admin decision (DELETE_RECORDS): the supervisor may deactivate, not delete
      expect((await api('delete', `/admin/staff/${teamMember.id}`, supervisorToken)).status).toBe(403);
      expect((await api('delete', `/admin/staff/${teamMember.id}`, superAdmin.accessToken)).status).toBe(200);
      expect((await api('get', '/admin/me/permissions', memberToken)).status).toBe(401);
      expect((await signIn(teamMember.phone, 'Reset-Pass-456')).status).toBe(401);
      const list = (await api('get', '/admin/staff', supervisorToken)).body.data as any[];
      expect(list.some((r) => r.id === teamMember.id)).toBe(false);
      expect((await createAs(supervisorToken, { level: 'OPS_TEAM', phone: teamMember.phone })).status).toBe(201);
    });

    it('the presets follow the owner’s split: team runs orders, supervisor makes daily decisions, admin edits/deletes/settles', async () => {
      const presets = (await api('get', '/admin/staff', superAdmin.accessToken)).body.meta.presets as Array<{ key: string; permissions: string[] }>;
      const of = (k: string) => new Set(presets.find((p) => p.key === k)!.permissions);
      const team = of('OPS_TEAM'), sup = of('OPS_SUPERVISOR'), admin = of('ADMIN_GENERAL');
      for (const p of team) expect(sup.has(p)).toBe(true); // each level includes the one below
      for (const p of sup) expect(admin.has(p)).toBe(true);
      expect([...team]).toEqual(expect.arrayContaining([Permission.VIEW_ORDERS, Permission.MANAGE_ORDER_FULFILMENT, Permission.ASSIGN_REASSIGN_ORDERS, Permission.FLEET_VIEW]));
      for (const p of [Permission.MANAGE_ORDER_ISSUES, Permission.VERIFY_MANUAL_PAYMENTS, Permission.CLOSE_DRIVER_SETTLEMENTS, Permission.MANAGE_CUSTOMER_WALLET]) {
        expect(team.has(p)).toBe(false);
        expect(sup.has(p)).toBe(true);
      }
      for (const p of [Permission.DELETE_RECORDS, Permission.MANAGE_CATALOG, Permission.MANAGE_VENDORS, Permission.CLOSE_VENDOR_SETTLEMENTS, Permission.MANAGE_SETTLEMENT_PAYMENTS]) {
        expect(sup.has(p)).toBe(false);
        expect(admin.has(p)).toBe(true);
      }
    });
  });

  it('a staff member without MANAGE_STAFF_ACCOUNTS cannot manage anyone', async () => {
    const plain = await s.admin([Permission.VIEW_ORDERS], 'Plain Admin');
    expect((await createAs(plain.accessToken, { level: 'OPS_TEAM' })).status).toBe(403);
    expect((await api('get', '/admin/staff', plain.accessToken)).body.meta.creatableLevels).toEqual([]);
  });

  describe('changing my own password', () => {
    it('works for the super admin with the current password, refuses a wrong current password and a weak new one', async () => {
      const p = phone();
      const created = expectData<any>(await createAs(superAdmin.accessToken, { level: 'OPS_TEAM', phone: p }), 201);
      const token = await tokenFor(p);
      const change = (body: unknown) => world.api('post', '/auth/dashboard/password', { token, body });
      expect((await change({ currentPassword: 'Wrong-Pass-000', newPassword: 'Another-Pass-789' })).status).toBe(403);
      expect((await change({ currentPassword: STRONG, newPassword: 'weak' })).status).toBe(400);
      expect((await change({ currentPassword: STRONG, newPassword: STRONG })).status).toBe(400);
      expect((await change({ currentPassword: STRONG, newPassword: 'Another-Pass-789' })).status).toBe(200);
      expect((await signIn(created.phone)).status).toBe(401);
      expect((await signIn(created.phone, 'Another-Pass-789')).status).toBe(200);
    });

    it('a super admin changes their own password too', async () => {
      const token = superAdmin.accessToken;
      const res = await world.api('post', '/auth/dashboard/password', { token, body: { currentPassword: superAdmin.password, newPassword: 'Super-Admin-Pass-2026' } });
      expect(res.status).toBe(200);
      expect((await signIn(superAdmin.phone, 'Super-Admin-Pass-2026')).status).toBe(200);
    });
  });
});
