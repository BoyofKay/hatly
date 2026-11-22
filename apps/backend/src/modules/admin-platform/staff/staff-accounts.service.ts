import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, In, Repository } from 'typeorm';
import { Role } from '../../../common/enums/role.enum';
import { RefreshTokenStore } from '../../auth/refresh-token.store';
import { Permission } from '../../permissions/permission.enum';
import { PermissionsService } from '../../permissions/permissions.service';
import { User } from '../../users/entities/user.entity';
import { assertStrongStaffPassword } from './staff-password-policy';

export type StaffLevel = 'ADMIN' | 'OPS_SUPERVISOR' | 'OPS_TEAM';
export const STAFF_LEVELS: StaffLevel[] = ['ADMIN', 'OPS_SUPERVISOR', 'OPS_TEAM'];

/**
 * Permissions only an ADMIN-level account (or the super admin) may hold — never an operations supervisor or team member, whoever grants it.
 * Owner decision 2026-11-22: marketplace sectors (the Home categories, their photos and the custom-request switch) are admin-only.
 */
export const ADMIN_LEVEL_ONLY_PERMISSIONS: ReadonlySet<string> = new Set([Permission.MANAGE_MARKETPLACE_SECTORS]);

/** Higher number = more authority. SUPER_ADMIN is a role, above every level. */
const RANK: Record<StaffLevel | 'SUPER_ADMIN', number> = { SUPER_ADMIN: 4, ADMIN: 3, OPS_SUPERVISOR: 2, OPS_TEAM: 1 };

export interface StaffActor {
  id: string;
  role: string;
}

export interface StaffAccountView {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: 'SUPER_ADMIN' | 'ADMIN';
  level: StaffLevel | 'SUPER_ADMIN';
  isActive: boolean;
  createdAt: Date;
  permissions: string[];
  /** Whether the CALLER may edit / deactivate / delete / reset this account. Display aid; every action re-checks. */
  manageable: boolean;
}

const ALL_PERMISSIONS = new Set<string>(Object.values(Permission));

/**
 * Hatly staff accounts and their hierarchy: SUPER_ADMIN > ADMIN > OPS_SUPERVISOR > OPS_TEAM.
 *
 * Rules (every one enforced here, server-side):
 *  - A SUPER_ADMIN manages every staff account below SUPER_ADMIN. SUPER_ADMIN accounts are never created, edited or deleted here
 *    (the first one comes from `bootstrap-admin`; each one changes its own password from its profile).
 *  - Any other staff member needs MANAGE_STAFF_ACCOUNTS, and then manages ONLY levels strictly below their own
 *    (an ADMIN manages supervisors and the team; a supervisor manages the team).
 *  - Nobody manages their own account here (that is what "change my password" is for), so nobody can raise their own level or grants.
 *  - A non-SUPER_ADMIN can only give permissions they hold themselves, and never takes away a permission they do not hold.
 *  - "Delete" is a soft delete: the account is deactivated, its permissions are removed, its phone is released for reuse, and its history
 *    (orders it acted on, audit log) stays intact. Access ends on the next request (JwtStrategy re-reads staff accounts every request).
 */
@Injectable()
export class StaffAccountsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly permissions: PermissionsService,
    private readonly sessions: RefreshTokenStore,
    private readonly ds: DataSource,
  ) {}

  // ---------------------------------------------------------------- reads

  async list(actor: StaffActor): Promise<StaffAccountView[]> {
    const actorRank = await this.rankOf(actor);
    const canManage = await this.canManageStaff(actor);
    const rows = await this.users.find({ where: { role: In([Role.ADMIN, Role.SUPER_ADMIN]) }, order: { createdAt: 'ASC' } });
    const visible = actor.role === Role.SUPER_ADMIN ? rows : rows.filter((u) => u.id === actor.id || this.rankOfUser(u) < actorRank);
    return Promise.all(visible.map(async (u) => this.view(u, canManage && u.id !== actor.id && this.rankOfUser(u) < actorRank)));
  }

  async get(actor: StaffActor, id: string): Promise<StaffAccountView> {
    const target = await this.loadManageable(actor, id);
    return this.view(target, true);
  }

  /** The levels the caller may create or move people into (strictly below their own). */
  async creatableLevels(actor: StaffActor): Promise<StaffLevel[]> {
    if (!(await this.canManageStaff(actor))) return [];
    const rank = await this.rankOf(actor);
    return STAFF_LEVELS.filter((l) => RANK[l] < rank);
  }

  /** What the caller's "add / edit staff" form may offer: the permissions they may give and the level presets. */
  async formOptions(actor: StaffActor): Promise<{ grantable: string[]; presets: Array<{ key: string; nameEn: string; nameAr: string; descriptionEn: string; descriptionAr: string; permissions: string[] }> }> {
    const grantable = actor.role === Role.SUPER_ADMIN ? [...ALL_PERMISSIONS] : await this.permissions.listPermissions(actor.id);
    const rows = await this.ds.query(
      `SELECT key, name_en, name_ar, description_en, description_ar, permissions FROM permission_templates WHERE key = ANY($1) ORDER BY array_position($1, key)`,
      [['OPS_TEAM', 'OPS_SUPERVISOR', 'ADMIN_GENERAL']],
    );
    return {
      grantable: grantable.sort(),
      presets: rows.map((r: any) => ({ key: r.key, nameEn: r.name_en, nameAr: r.name_ar, descriptionEn: r.description_en, descriptionAr: r.description_ar, permissions: r.permissions })),
    };
  }

  // ---------------------------------------------------------------- writes

  async create(
    actor: StaffActor,
    input: { fullName: string; phone: string; email?: string; password: string; level: StaffLevel; permissions?: string[]; templateKey?: string },
  ): Promise<StaffAccountView> {
    await this.assertCanManageStaff(actor);
    await this.assertLevelBelowActor(actor, input.level);
    assertStrongStaffPassword(input.password);
    const wanted = await this.resolveRequestedPermissions(input.permissions, input.templateKey);
    await this.assertActorMayGrant(actor, wanted);
    this.assertFitsLevel(input.level, wanted);
    await this.assertPhoneFree(input.phone);

    const passwordHash = await bcrypt.hash(input.password, 10);
    const saved = await this.ds.transaction(async (m) => {
      const repo = m.getRepository(User);
      const user = await repo.save(
        repo.create({
          phone: input.phone,
          fullName: input.fullName.trim(),
          email: input.email?.trim() || null,
          passwordHash,
          role: Role.ADMIN,
          staffLevel: input.level,
          isPhoneVerified: true,
          isActive: true,
        }),
      );
      for (const p of wanted) {
        await m.query(`INSERT INTO admin_permissions (user_id, permission, granted_by_user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [user.id, p, actor.id]);
      }
      return user;
    });
    return this.view(saved, true);
  }

  async update(actor: StaffActor, id: string, input: { fullName?: string; phone?: string; email?: string | null; level?: StaffLevel }): Promise<StaffAccountView> {
    const target = await this.loadManageable(actor, id);
    if (input.level !== undefined && input.level !== target.staffLevel) await this.assertLevelBelowActor(actor, input.level);
    if (input.phone !== undefined && input.phone !== target.phone) await this.assertPhoneFree(input.phone);
    const patch: Partial<User> = {};
    if (input.fullName !== undefined) patch.fullName = input.fullName.trim();
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.email !== undefined) patch.email = input.email?.trim() || null;
    if (input.level !== undefined) patch.staffLevel = input.level;
    if (Object.keys(patch).length > 0) await this.users.update({ id }, patch);
    // Moved below ADMIN: admin-only permissions go with the old level.
    if (input.level !== undefined && input.level !== 'ADMIN') {
      for (const p of ADMIN_LEVEL_ONLY_PERMISSIONS) await this.permissions.revoke(id, p as Permission);
    }
    // A phone change is a sign-in identity change: end the current session so the account signs in again with the new number.
    if (patch.phone) await this.sessions.revoke(id);
    return this.view((await this.users.findOne({ where: { id } }))!, true);
  }

  async setActive(actor: StaffActor, id: string, active: boolean): Promise<StaffAccountView> {
    const target = await this.loadManageable(actor, id);
    await this.users.update({ id }, { isActive: active });
    if (!active) await this.sessions.revoke(id);
    return this.view({ ...target, isActive: active } as User, true);
  }

  async resetPassword(actor: StaffActor, id: string, newPassword: string): Promise<void> {
    await this.loadManageable(actor, id);
    assertStrongStaffPassword(newPassword);
    await this.users.update({ id }, { passwordHash: await bcrypt.hash(newPassword, 10) });
    await this.sessions.revoke(id); // whoever was signed in with the old password signs in again
  }

  /**
   * Makes the account's permissions exactly `permissions`, except that a non-SUPER_ADMIN caller never touches permissions they do not
   * hold themselves (they cannot give them, and they cannot take them away either — those stay as the super admin set them).
   */
  async setPermissions(actor: StaffActor, id: string, permissions: string[]): Promise<StaffAccountView> {
    const target = await this.loadManageable(actor, id);
    const wanted = await this.resolveRequestedPermissions(permissions, undefined);
    await this.assertActorMayGrant(actor, wanted);
    this.assertFitsLevel(((target.staffLevel as StaffLevel) ?? 'ADMIN'), wanted);
    const actorHeld = actor.role === Role.SUPER_ADMIN ? ALL_PERMISSIONS : new Set<string>(await this.permissions.listPermissions(actor.id));
    const current = new Set<string>(await this.permissions.listPermissions(id));
    for (const p of wanted) if (!current.has(p)) await this.permissions.grant(id, p as Permission, actor.id);
    for (const p of current) if (!wanted.includes(p) && actorHeld.has(p)) await this.permissions.revoke(id, p as Permission);
    return this.view(target, true);
  }

  async remove(actor: StaffActor, id: string): Promise<void> {
    const target = await this.loadManageable(actor, id);
    if (!(await this.permissions.actorHolds(actor, Permission.DELETE_RECORDS))) {
      throw new ForbiddenException({ message: 'Deleting needs the DELETE_RECORDS permission (admins). Deactivate the account instead.', details: { code: 'DELETE_NOT_ALLOWED' } });
    }
    // `phone` is unique and at most 20 characters: free it for reuse with a marker that cannot collide with a real number.
    const releasedPhone = `del-${target.id.replace(/-/g, '').slice(0, 16)}`;
    await this.ds.transaction(async (m) => {
      await m.query(`DELETE FROM admin_permissions WHERE user_id = $1`, [id]);
      await m.query(`UPDATE users SET is_active = false, phone = $2, deleted_at = now(), updated_at = now() WHERE id = $1`, [id, releasedPhone]);
    });
    await this.sessions.revoke(id);
  }

  // ---------------------------------------------------------------- rules

  private rankOfUser(u: Pick<User, 'role' | 'staffLevel'>): number {
    if (u.role === Role.SUPER_ADMIN) return RANK.SUPER_ADMIN;
    if (u.role !== Role.ADMIN) return 0;
    return RANK[(u.staffLevel as StaffLevel) ?? 'ADMIN'] ?? RANK.ADMIN;
  }

  private async rankOf(actor: StaffActor): Promise<number> {
    if (actor.role === Role.SUPER_ADMIN) return RANK.SUPER_ADMIN;
    if (actor.role !== Role.ADMIN) return 0;
    const me = await this.users.findOne({ where: { id: actor.id } });
    return me ? this.rankOfUser(me) : 0;
  }

  private canManageStaff(actor: StaffActor): Promise<boolean> {
    return this.permissions.actorHolds(actor, Permission.MANAGE_STAFF_ACCOUNTS);
  }

  private async assertCanManageStaff(actor: StaffActor): Promise<void> {
    if (!(await this.canManageStaff(actor))) {
      throw new ForbiddenException({ message: 'You do not have permission to manage staff accounts.', details: { code: 'STAFF_MANAGEMENT_FORBIDDEN' } });
    }
  }

  private async assertLevelBelowActor(actor: StaffActor, level: StaffLevel): Promise<void> {
    if (!STAFF_LEVELS.includes(level)) throw new BadRequestException({ message: 'Unknown staff level.', details: { code: 'UNKNOWN_STAFF_LEVEL' } });
    if (RANK[level] >= (await this.rankOf(actor))) {
      throw new ForbiddenException({ message: 'You can only create or move staff into a level below your own.', details: { code: 'STAFF_LEVEL_NOT_BELOW_YOU' } });
    }
  }

  /** The target must exist, be an ADMIN-role staff account (never a SUPER_ADMIN), not be the caller, and sit strictly below the caller. */
  private async loadManageable(actor: StaffActor, id: string): Promise<User> {
    await this.assertCanManageStaff(actor);
    const target = await this.users.findOne({ where: { id } });
    // Same "not found" answer for every refusal that would otherwise reveal an account above the caller.
    if (!target || target.role !== Role.ADMIN) throw new NotFoundException('Staff account not found.');
    if (target.id === actor.id) {
      throw new ForbiddenException({ message: 'You cannot manage your own account here. Use “Change my password” in your profile.', details: { code: 'STAFF_SELF_MANAGEMENT' } });
    }
    if (this.rankOfUser(target) >= (await this.rankOf(actor))) throw new NotFoundException('Staff account not found.');
    return target;
  }

  private async resolveRequestedPermissions(permissions: string[] | undefined, templateKey: string | undefined): Promise<string[]> {
    let wanted = [...new Set(permissions ?? [])];
    if (templateKey) {
      const [t] = await this.ds.query(`SELECT permissions FROM permission_templates WHERE key = $1`, [templateKey]);
      if (!t) throw new BadRequestException({ message: 'Unknown permission template.', details: { code: 'UNKNOWN_TEMPLATE' } });
      wanted = [...new Set([...wanted, ...(t.permissions as string[])])];
    }
    const unknown = wanted.filter((p) => !ALL_PERMISSIONS.has(p));
    if (unknown.length > 0) throw new BadRequestException({ message: `Unknown permission(s): ${unknown.join(', ')}.`, details: { code: 'UNKNOWN_PERMISSION' } });
    return wanted;
  }

  /** An admin-only permission can never be given to a supervisor or a team member. */
  private assertFitsLevel(level: StaffLevel, wanted: string[]): void {
    if (level === 'ADMIN') return;
    const adminOnly = wanted.filter((p) => ADMIN_LEVEL_ONLY_PERMISSIONS.has(p));
    if (adminOnly.length > 0) {
      throw new ForbiddenException({ message: `Only admins can hold: ${adminOnly.join(', ')}.`, details: { code: 'ADMIN_LEVEL_ONLY_PERMISSION', permissions: adminOnly } });
    }
  }

  private async assertActorMayGrant(actor: StaffActor, wanted: string[]): Promise<void> {
    if (actor.role === Role.SUPER_ADMIN) return;
    const held = new Set<string>(await this.permissions.listPermissions(actor.id));
    const beyond = wanted.filter((p) => !held.has(p));
    if (beyond.length > 0) {
      throw new ForbiddenException({ message: `You can only give permissions you have yourself. Not yours: ${beyond.join(', ')}.`, details: { code: 'GRANT_EXCEEDS_YOUR_PERMISSIONS', permissions: beyond } });
    }
  }

  private async assertPhoneFree(phone: string): Promise<void> {
    const [row] = await this.ds.query(`SELECT 1 FROM users WHERE phone = $1 LIMIT 1`, [phone]);
    if (row) throw new ConflictException({ message: 'An account with this phone number already exists.', details: { code: 'PHONE_IN_USE' } });
  }

  private async view(u: User, manageable: boolean): Promise<StaffAccountView> {
    return {
      id: u.id,
      fullName: u.fullName,
      phone: u.phone,
      email: u.email ?? null,
      role: u.role as 'SUPER_ADMIN' | 'ADMIN',
      level: u.role === Role.SUPER_ADMIN ? 'SUPER_ADMIN' : ((u.staffLevel as StaffLevel) ?? 'ADMIN'),
      isActive: u.isActive,
      createdAt: u.createdAt,
      // SUPER_ADMIN holds everything by role and never has explicit grants; never fabricated as "all".
      permissions: u.role === Role.SUPER_ADMIN ? [] : await this.permissions.listPermissions(u.id),
      manageable,
    };
  }
}
