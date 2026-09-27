import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import { Permission } from '../permissions/permission.enum';
import { OrderActorAuthorizationService } from './order-actor-authorization.service';

function build(state: {
  order?: { id: string; customerId: string } | null;
  segments?: Array<{ id: string; vendorBranchId: string | null; status?: string }>;
  ownedBranchIds?: string[];
  driver?: { id: string } | null;
  delivery?: { driverId: string } | null;
  granted?: Permission[];
}) {
  const orders = { findOne: jest.fn().mockResolvedValue(state.order ?? null) };
  const segments = { find: jest.fn().mockResolvedValue(state.segments ?? []) };
  const deliveries = { findOne: jest.fn().mockResolvedValue(state.delivery ?? null) };
  const drivers = { findOne: jest.fn().mockResolvedValue(state.driver ?? null) };
  const vendorStaff = { getOwnedBranchIds: jest.fn().mockResolvedValue(state.ownedBranchIds ?? []) };
  const permissions = { hasPermission: jest.fn(async (_u: string, p: Permission) => (state.granted ?? []).includes(p)) };
  return new OrderActorAuthorizationService(orders as never, segments as never, deliveries as never, drivers as never, vendorStaff as never, permissions as never);
}

const user = (role: Role, id = 'user-1') => ({ id, role });

describe('OrderActorAuthorizationService', () => {
  it('SUPER_ADMIN always passes, with no lookups', async () => {
    await expect(build({}).assertMayActOnOrder(user(Role.SUPER_ADMIN), 'o1')).resolves.toBeUndefined();
  });

  it('ADMIN needs MANAGE_ORDER_ISSUES', async () => {
    await expect(build({ granted: [] }).assertMayActOnOrder(user(Role.ADMIN), 'o1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(build({ granted: [Permission.VIEW_ORDERS] }).assertMayActOnOrder(user(Role.ADMIN), 'o1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(build({ granted: [Permission.MANAGE_ORDER_ISSUES] }).assertMayActOnOrder(user(Role.ADMIN), 'o1')).resolves.toBeUndefined();
  });

  it('CUSTOMER only for their own order; otherwise 404 (same as a missing order)', async () => {
    await expect(build({ order: { id: 'o1', customerId: 'user-1' } }).assertMayActOnOrder(user(Role.CUSTOMER), 'o1')).resolves.toBeUndefined();
    await expect(build({ order: { id: 'o1', customerId: 'someone-else' } }).assertMayActOnOrder(user(Role.CUSTOMER), 'o1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ order: null }).assertMayActOnOrder(user(Role.CUSTOMER), 'o1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([Role.VENDOR, Role.VENDOR_MANAGER])('%s only when one of their branches has a segment of the order', async (role) => {
    const segments = [{ id: 's1', vendorBranchId: 'branch-A' }, { id: 's2', vendorBranchId: 'branch-B' }];
    await expect(build({ ownedBranchIds: ['branch-B'], segments }).assertMayActOnOrder(user(role), 'o1')).resolves.toBeUndefined();
    await expect(build({ ownedBranchIds: ['branch-C'], segments }).assertMayActOnOrder(user(role), 'o1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ ownedBranchIds: [], segments }).assertMayActOnOrder(user(role), 'o1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ ownedBranchIds: ['branch-A'], segments: [{ id: 's3', vendorBranchId: null }] }).assertMayActOnOrder(user(role), 'o1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DRIVER only for the delivery assigned to them', async () => {
    await expect(build({ driver: { id: 'drv-1' }, delivery: { driverId: 'drv-1' } }).assertMayActOnOrder(user(Role.DRIVER), 'o1')).resolves.toBeUndefined();
    await expect(build({ driver: { id: 'drv-1' }, delivery: { driverId: 'drv-2' } }).assertMayActOnOrder(user(Role.DRIVER), 'o1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ driver: { id: 'drv-1' }, delivery: null }).assertMayActOnOrder(user(Role.DRIVER), 'o1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ driver: null, delivery: { driverId: 'drv-1' } }).assertMayActOnOrder(user(Role.DRIVER), 'o1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('an unknown role is refused', async () => {
    await expect(build({}).assertMayActOnOrder({ id: 'x', role: 'ROOT' }, 'o1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrderActorAuthorizationService.assertVendorMayCancelWholeOrder (PD-002: a vendor cancels only its OWN segment)', () => {
  const A = { id: 's1', vendorBranchId: 'branch-A', status: 'PENDING' };
  const B = { id: 's2', vendorBranchId: 'branch-B', status: 'PENDING' };

  it.each([Role.VENDOR, Role.VENDOR_MANAGER])('%s: allowed when every active segment is its own (single-vendor order)', async (role) => {
    await expect(build({ ownedBranchIds: ['branch-A'], segments: [A] }).assertVendorMayCancelWholeOrder(user(role), 'o1')).resolves.toBeUndefined();
  });

  it.each([Role.VENDOR, Role.VENDOR_MANAGER])('%s: REFUSED while another vendor still has an active segment', async (role) => {
    const svc = build({ ownedBranchIds: ['branch-A'], segments: [A, B] });
    await expect(svc.assertVendorMayCancelWholeOrder(user(role), 'o1')).rejects.toMatchObject({
      response: { details: { code: 'VENDOR_MAY_ONLY_CANCEL_OWN_SEGMENT' } },
    });
  });

  it('allowed once the OTHER vendors have already cancelled their segments (it is then its own last segment)', async () => {
    const svc = build({ ownedBranchIds: ['branch-A'], segments: [A, { ...B, status: 'CANCELLED' }] });
    await expect(svc.assertVendorMayCancelWholeOrder(user(Role.VENDOR), 'o1')).resolves.toBeUndefined();
  });

  it('a vendor whose own segment was cancelled cannot cancel the other vendor\'s last active segment', async () => {
    const svc = build({ ownedBranchIds: ['branch-A'], segments: [{ ...A, status: 'CANCELLED' }, B] });
    await expect(svc.assertVendorMayCancelWholeOrder(user(Role.VENDOR), 'o1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a segment with no branch (ad-hoc) is never "own"', async () => {
    const svc = build({ ownedBranchIds: ['branch-A'], segments: [{ id: 's9', vendorBranchId: null, status: 'PENDING' }] });
    await expect(svc.assertVendorMayCancelWholeOrder(user(Role.VENDOR), 'o1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([Role.ADMIN, Role.SUPER_ADMIN, Role.CUSTOMER, Role.DRIVER])('%s is not restricted by this rule (its own checks apply)', async (role) => {
    await expect(build({ segments: [A, B] }).assertVendorMayCancelWholeOrder(user(role), 'o1')).resolves.toBeUndefined();
  });
});
