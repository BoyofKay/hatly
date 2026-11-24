import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { HomeBannerActionType } from '../home-banner-action.enum';

/**
 * A promotional banner on the customer Home carousel, managed by an admin (permission MANAGE_HOME_BANNERS).
 *
 * - Created INACTIVE (a draft); it can only be activated once it has an image, so a half-configured banner is never shown.
 * - `imageUrl` is the stable reference the existing upload provider returns (`/uploads/files/<uuid>.<ext>`), set ONLY by the
 *   dedicated image endpoint — never an arbitrary external URL, never a signed URL.
 * - `title` is the banner's accessible description (screen readers) and the admin's label; the image itself carries the message.
 * - `startsAt` / `endsAt` (both optional) schedule it; the public list returns only banners eligible RIGHT NOW.
 * - `actionType` + `actionTargetId`: an in-app destination (see HomeBannerActionType); the target is validated when written.
 * Soft-deleted (BaseEntity.deletedAt), like every other admin-managed entity.
 */
@Entity({ name: 'home_banners' })
@Index('IDX_home_banners_active_sort', ['isActive', 'sortOrder'])
export class HomeBanner extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ name: 'title_ar', type: 'varchar', length: 120, nullable: true })
  titleAr?: string | null;

  @Column({ name: 'image_url', type: 'varchar', length: 500, nullable: true })
  imageUrl?: string | null;

  @Column({ name: 'image_url_ar', type: 'varchar', length: 500, nullable: true })
  imageUrlAr?: string | null;

  @Column({ name: 'action_type', type: 'varchar', length: 10, default: HomeBannerActionType.NONE })
  actionType: HomeBannerActionType;

  @Column({ name: 'action_target_id', type: 'uuid', nullable: true })
  actionTargetId?: string | null;

  @Column({ name: 'sector_id', type: 'uuid', nullable: true })
  sectorId?: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt?: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt?: Date | null;
}
