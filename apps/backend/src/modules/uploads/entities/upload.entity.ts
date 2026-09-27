import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * One row per successful upload. This table is the actual enforcement
 * mechanism behind "imageUrls must only contain references produced
 * by the Hatly upload mechanism" — CartService checks every submitted
 * URL against this table (and that it belongs to the same customer)
 * before accepting it onto a CartItem; a URL that isn't a real row
 * here (an arbitrary external image link) is rejected. See
 * cart.service.ts's option/image validation.
 */
@Entity({ name: 'uploads' })
export class Upload extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  url: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'uploaded_by_user_id' })
  uploadedBy: User;

  @Index()
  @Column({ name: 'uploaded_by_user_id' })
  uploadedByUserId: string;
}
