import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CAIRO = 'Africa/Cairo';
export const bad = (message: string, code = 'VALIDATION_FAILED') => new BadRequestException({ message, details: { code } });
export const notFound = (what = 'Not found.') => new NotFoundException({ message: what, details: { code: 'NOT_FOUND' } });
export const num = (v: unknown) => (v == null ? null : Number(v));

export interface Actor {
  id: string;
  role: string;
}

/** The branch must be one of the caller's own; anything else answers exactly like a branch that does not exist. */
export async function ownedBranch(auth: VendorStaffAuthorizationService, user: Actor, branchId: string): Promise<string> {
  if (!UUID_RE.test(branchId ?? '')) throw notFound('Branch not found.');
  const owned = await auth.getOwnedBranchIds(user.id);
  if (!owned.includes(branchId)) throw notFound('Branch not found.');
  return branchId;
}

export { effectiveOpenSql } from '../../common/branch-availability';
