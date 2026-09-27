import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

/**
 * Marks a controller or handler as restricted to the given roles.
 * Always paired with RolesGuard, which is the only thing that actually
 * enforces this — never rely on the frontend/client to hide UI as a
 * substitute for this check.
 *
 * Usage: @Roles(Role.ADMIN, Role.SUPER_ADMIN)
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
