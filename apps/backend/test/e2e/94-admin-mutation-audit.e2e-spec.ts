/**
 * Security milestone — every privileged (ADMIN / SUPER_ADMIN) mutation is on record in the append-only `admin_audit_logs`
 * (AdminMutationAuditInterceptor), with field NAMES only — never values — and refused attempts recorded as FAILURE.
 * Real HTTP, real database, real global interceptor chain.
 */
import { bootWorld, World } from './support/world';
import { Scenario, expectData } from './support/actors';
import { scanRoutes } from './support/route-inventory';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { EXPLICITLY_AUDITED_KEY } from '../../src/modules/audit/admin-mutation-audit.interceptor';

const NEVER_EXISTS = '00000000-0000-4000-8000-000000000000';

describe('E2E — admin mutation audit coverage', () => {
  let world: World;
  let s: Scenario;
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const rowsFor = (actorId: string) =>
    q("SELECT action, target_type, target_id, outcome, metadata FROM admin_audit_logs WHERE actor_user_id = $1 ORDER BY created_at, id", [actorId]);

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

  it('a delivery-fee change and a driver verification are recorded: actor, route, target, permission, field NAMES — never the values', async () => {
    const admin = await s.admin([Permission.MANAGE_SERVICE_AREAS, Permission.MANAGE_DELIVERY_FEE_MULTIPLIER, Permission.MANAGE_DRIVERS], 'Audited Ops');
    const zone = await s.deliveryZone({ feeMinor: 1500 });
    expectData(await world.api('patch', `/admin/delivery-zones/${zone.id}/delivery-fee`, { token: admin.accessToken, body: { deliveryFeeMinor: 98765 } }));
    const driver = await s.driver({ lat: 30.42, lng: 31.56 });
    expectData(await world.api('patch', `/admin/drivers/${driver.driverId}/verification`, { token: admin.accessToken, body: { status: 'REJECTED' } }));

    const rows = await rowsFor(admin.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ action: 'admin.mutation', target_type: 'delivery-zones', target_id: zone.id, outcome: 'SUCCESS' });
    expect(rows[0].metadata).toMatchObject({ method: 'PATCH', route: '/api/v1/admin/delivery-zones/:id/delivery-fee', status: 200, fields: 'deliveryFeeMinor' });
    expect(rows[0].metadata.permission).toContain('MANAGE_DELIVERY_FEE_MULTIPLIER');
    expect(JSON.stringify(rows)).not.toContain('98765'); // the new fee itself is never in the audit log
    expect(rows[1]).toMatchObject({ action: 'admin.mutation', target_type: 'drivers', target_id: driver.driverId, outcome: 'SUCCESS' });
    expect(JSON.stringify(rows[1])).not.toContain('REJECTED');
  });

  it('a refused attempt that reaches the handler is recorded as FAILURE with its status', async () => {
    const admin = await s.admin([Permission.MANAGE_DRIVERS], 'Audited Failure');
    expect((await world.api('patch', `/admin/drivers/${NEVER_EXISTS}/verification`, { token: admin.accessToken, body: { status: 'APPROVED' } })).status).toBe(404);
    const rows = await rowsFor(admin.id);
    expect(rows).toEqual([expect.objectContaining({ action: 'admin.mutation', outcome: 'FAILURE', target_id: NEVER_EXISTS })]);
    expect(rows[0].metadata).toMatchObject({ status: 404 });
  });

  it('explicitly audited actions are not recorded twice; reads and non-admin mutations are not recorded at all', async () => {
    const superAdmin = await s.superAdmin();
    const before = (await rowsFor(superAdmin.id)).length;
    expectData(await world.api('put', '/admin/business-config/CHECKOUT_QUOTE_TTL_SECONDS', { token: superAdmin.accessToken, body: { value: 610 } }));
    expectData(await world.api('get', '/admin/orders', { token: superAdmin.accessToken }));
    const after = (await rowsFor(superAdmin.id)).slice(before).map((r: any) => r.action);
    expect(after).toEqual(['business_config.changed']);

    const customer = await s.customer('Not Audited');
    await world.api('post', '/favorites', { token: customer.accessToken, body: { vendorId: NEVER_EXISTS } });
    expect(await rowsFor(customer.id)).toEqual([]);
  });

  it('coverage: every ADMIN-reachable mutating route is either explicitly audited or reaches the global interceptor (none bypass it)', async () => {
    const routes = scanRoutes(world.app).filter(
      (r) => r.verb !== 'GET' && !r.path.startsWith('/auth/') && (r.rule === 'PERMISSION' || r.roles.some((x) => x === 'ADMIN' || x === 'SUPER_ADMIN')),
    );
    expect(routes.length).toBeGreaterThan(70);
    // The interceptor is global (APP_INTERCEPTOR): the only way out is the explicit marker, which must sit on handlers that DO write
    // their own audit entry. This is the reviewed list.
    const reflector = world.app.get(require('@nestjs/core').Reflector);
    const explicit: string[] = [];
    for (const module of world.app.get(require('@nestjs/core').ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const proto = (wrapper.metatype as any)?.prototype;
        if (!proto) continue;
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name !== 'constructor' && typeof proto[name] === 'function' && reflector.get(EXPLICITLY_AUDITED_KEY, proto[name])) explicit.push(`${(wrapper.metatype as any).name}.${name}`);
        }
      }
    }
    expect(explicit.sort()).toEqual(
      [
        'AdminAccountDeletionRequestsController.complete',
        'AdminAccountDeletionRequestsController.reject',
        'AdminPermissionsController.grant',
        'AdminPermissionsController.revoke',
        'AdminVendorStaffController.activate',
        'AdminVendorStaffController.create',
        'AdminVendorStaffController.deactivate',
        // Vendor operations: each writes its own audit entry (branch closure scheduled/cancelled, settlement terms set).
        'AdminBranchClosuresController.cancel',
        'AdminBranchClosuresController.create',
        'AdminVendorSettlementTermsController.set',
        'BusinessConfigController.clear',
        'BusinessConfigController.set',
        'HatlyServicePricingController.upsert',
        'StaffMfaAdminController.reset',
        // Enterprise Admin Panel: each of these writes its OWN structured audit entry (see the controller) instead of the generic one.
        'AdminCustomersExtController.addNote',
        'AdminCustomersExtController.approve',
        'AdminCustomersExtController.block',
        'AdminCustomersExtController.hide',
        'AdminCustomersExtController.reject',
        'AdminCustomersExtController.requestAdjustment',
        'AdminCustomersExtController.reveal',
        'AdminCustomersExtController.unblock',
        'AdminCustomersExtController.unhide',
        'AdminFinanceController.recordPayment',
        'AdminFinanceController.voidPayment',
        'AdminOrderExceptionsController.assign',
        'AdminOrderExceptionsController.escalate',
        'AdminOrderExceptionsController.markForVendor',
        'AdminOrderExceptionsController.note',
        'AdminOrderExceptionsController.recordDecision',
        'AdminOrderExceptionsController.requestVendorAction',
        'AdminOrderExceptionsController.resolve',
        'AdminOrderExtrasController.addNote',
        'AdminOrderExtrasController.cancel',
        'ConfigOverviewController.setAutomation',
        'DirectoryController.bulk',
        'MarketingController.approveBroadcast',
        'MarketingController.approveCampaign',
        'MarketingController.cancelBroadcast',
        'MarketingController.cancelCampaign',
        'MarketingController.cloneOffer',
        'MarketingController.editOffer',
        'MarketingController.rejectBroadcast',
        'MarketingController.rejectCampaign',
        'MarketingController.submitBroadcast',
        'MarketingController.submitCampaign',
        'MediaController.assign',
        'MediaController.backfill',
        'MediaController.purge',
        'MediaController.remove',
        'MediaController.restore',
        'MediaController.setProductImages',
        'MediaController.update',
        'MediaController.upload',
        'PermissionTemplatesController.apply',
        'PermissionTemplatesController.create',
        'PermissionTemplatesController.remove',
        'PermissionTemplatesController.update',
        'ReportsController.cancel',
        'ReportsController.createExport',
        'SystemController.check',
        'SystemController.retry',
      ].sort(),
    );
  });
});
