import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/** Launch-readiness G-11. `page`/`limit` follow the same silently-clamped contract as the other admin lists (never a 400 for a large limit). */
export class ListAuditLogsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  /** Exact action name, e.g. `auth.dashboard_login_failed` or `admin.mutation`. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;

  @IsOptional()
  @IsIn(['SUCCESS', 'FAILURE'])
  outcome?: 'SUCCESS' | 'FAILURE';

  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  targetType?: string;

  /** Exact match on the free-text target reference (a user id, a setting name, a masked phone). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  targetRef?: string;

  /** ISO-8601 instants (inclusive). */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
