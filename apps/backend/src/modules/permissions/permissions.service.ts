import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminPermission } from './entities/admin-permission.entity';
import { Permission } from './permission.enum';
import { Role } from '../../common/enums/role.enum';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(AdminPermission)
    private readonly repo: Repository<AdminPermission>,
  ) {}

  /**
   * SUPER_ADMIN is intentionally not looked up here — this method only
   * ever answers "does this ADMIN have this explicit grant." Callers
   * that need the full "is this user allowed" answer (including the
   * SUPER_ADMIN-bypasses-everything rule) should use PermissionsGuard,
   * not call this directly for authorization decisions.
   */
  async hasPermission(userId: string, permission: Permission): Promise<boolean> {
    const grant = await this.repo.findOne({ where: { userId, permission } });
    return grant != null;
  }

  /**
   * Whether this ADMIN/SUPER_ADMIN actor holds `permission`, applying the same rule as PermissionsGuard: a SUPER_ADMIN holds
   * every permission automatically (approved requirement 7), an ADMIN needs an explicit grant, anyone else holds none. Use
   * this — not `hasPermission(user.id, …)` — for in-handler checks, which otherwise silently deny a SUPER_ADMIN.
   */
  async actorHolds(actor: { id: string; role: string }, permission: Permission): Promise<boolean> {
    if (actor.role === Role.SUPER_ADMIN) return true;
    if (actor.role !== Role.ADMIN) return false;
    return this.hasPermission(actor.id, permission);
  }

  async listPermissions(userId: string): Promise<Permission[]> {
    const grants = await this.repo.find({ where: { userId } });
    return grants.map((g) => g.permission);
  }

  /**
   * Idempotent by design (requirement: "financial events must be
   * idempotent" — the same discipline applies here even though this
   * isn't a financial action: re-granting an already-granted
   * permission should never error). The unique index on
   * (user_id, permission) — see the migration — is the actual
   * enforcement; this catches that conflict and treats it as success
   * rather than surfacing a confusing duplicate-key error.
   */
  async grant(userId: string, permission: Permission, grantedByUserId: string): Promise<AdminPermission> {
    const existing = await this.repo.findOne({ where: { userId, permission } });
    if (existing) return existing;

    try {
      return await this.repo.save(this.repo.create({ userId, permission, grantedByUserId }));
    } catch (error) {
      // Concurrent grant of the same permission — the unique index
      // rejected the insert; treat as already-granted rather than an error.
      const existingAfterRace = await this.repo.findOne({ where: { userId, permission } });
      if (existingAfterRace) return existingAfterRace;
      throw error;
    }
  }

  async revoke(userId: string, permission: Permission): Promise<void> {
    const existing = await this.repo.findOne({ where: { userId, permission } });
    if (!existing) {
      throw new NotFoundException('That permission is not currently granted to this user.');
    }
    await this.repo.remove(existing);
  }

  /** Used by the grant/revoke controller to reject targeting a non-ADMIN user. */
  assertGrantableRole(role: string): void {
    if (role !== Role.ADMIN) {
      throw new ConflictException({
        message: 'Permissions can only be granted to ADMIN users. SUPER_ADMIN already has every permission; other roles are not admin-tier.',
        details: { code: 'NOT_AN_ADMIN_USER' },
      });
    }
  }
}
