import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminAuditAction, AdminAuditService } from '../../audit/admin-audit.service';
import { ExplicitlyAudited } from '../../audit/admin-mutation-audit.interceptor';
import { UsersService } from '../../users/users.service';
import { PermissionTemplatesService } from './permission-templates.service';

class CreateTemplateDto {
  @IsString() @MaxLength(39) key: string;
  @IsString() @MaxLength(80) nameEn: string;
  @IsString() @MaxLength(80) nameAr: string;
  @IsArray() @IsString({ each: true }) permissions: string[];
}

class UpdateTemplateDto {
  @IsOptional() @IsString() @MaxLength(80) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(80) nameAr?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) permissions?: string[];
}

class ApplyTemplateDto {
  @IsString() templateId: string;
  @IsIn(['ADD', 'REPLACE']) mode: 'ADD' | 'REPLACE';
}

/** Role templates = presets that are copied onto an admin. SUPER_ADMIN only (same authority as granting permissions). */
@ApiTags('admin-permission-templates')
@Controller('admin')
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class PermissionTemplatesController {
  constructor(
    private readonly templates: PermissionTemplatesService,
    private readonly users: UsersService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('permission-templates')
  async list() {
    return { data: await this.templates.list() };
  }

  @Post('permission-templates')
  @ExplicitlyAudited()
  async create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateTemplateDto) {
    const data = await this.templates.create(dto, actor.id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.TEMPLATE_CREATED, targetType: 'permission_template', targetId: data.id, metadata: { key: data.key, permissions: data.permissions.length } });
    return { data };
  }

  @Patch('permission-templates/:id')
  @ExplicitlyAudited()
  async update(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    const data = await this.templates.update(id, dto);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.TEMPLATE_UPDATED, targetType: 'permission_template', targetId: id, metadata: { permissions: data.permissions.length } });
    return { data };
  }

  @Delete('permission-templates/:id')
  @ExplicitlyAudited()
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    await this.templates.remove(id);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.TEMPLATE_DELETED, targetType: 'permission_template', targetId: id });
    return { message: 'Template deleted.' };
  }

  @Post('users/:userId/apply-template')
  @ExplicitlyAudited()
  async apply(@CurrentUser() actor: AuthenticatedUser, @Param('userId') userId: string, @Body() dto: ApplyTemplateDto) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found.');
    if (user.role !== Role.ADMIN) {
      // Same rule as individual grants: only ADMIN users hold explicit permissions.
      throw new NotFoundException('Templates can only be applied to ADMIN users.');
    }
    const diff = await this.templates.apply(userId, dto.templateId, dto.mode, actor.id);
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: AdminAuditAction.TEMPLATE_APPLIED,
      targetType: 'user',
      targetId: userId,
      metadata: { template: diff.template, mode: diff.mode, added: diff.added.length, removed: diff.removed.length, addedList: diff.added.join(','), removedList: diff.removed.join(',') },
    });
    return { data: diff };
  }
}
