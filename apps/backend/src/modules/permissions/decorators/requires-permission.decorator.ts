import { SetMetadata } from '@nestjs/common';
import { Permission } from '../permission.enum';

export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Marks a controller/handler as requiring one or more specific admin
 * permissions — enforced by PermissionsGuard, which also independently
 * confirms the caller is ADMIN or SUPER_ADMIN (so this decorator alone
 * is sufficient on an admin endpoint; it does not need to be paired
 * with @Roles as well — see permissions.guard.ts's own doc comment for
 * why that redundancy was deliberately designed out).
 *
 * Multiple permissions means ALL are required (AND semantics), not
 * "any one of them" — the safer default for a financial/operational
 * action that genuinely depends on more than one capability.
 *
 * Usage: @RequiresPermission(Permission.CLOSE_VENDOR_SETTLEMENTS)
 */
export const RequiresPermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
