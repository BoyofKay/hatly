import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const NOTIFICATIONS_MAX_LIMIT = 50;
export const NOTIFICATIONS_DEFAULT_LIMIT = 20;
/** Hard ceiling on how deep the history can be paged — the list is a recent-activity feed, not an archive. */
export const NOTIFICATIONS_MAX_PAGE = 20;

export class ListNotificationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATIONS_MAX_PAGE)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATIONS_MAX_LIMIT)
  limit?: number;
}
