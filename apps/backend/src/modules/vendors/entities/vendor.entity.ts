import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { VendorBranch } from './vendor-branch.entity';

@Entity({ name: 'vendors' })
export class Vendor extends BaseEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 150, nullable: true })
  nameAr?: string | null;

  // Inert Phase-1 legacy column: superseded by marketplace sectors, never written by the
  // application. Nullable since migration 1700003900000 (it was NOT NULL with no default, which
  // made every Vendor INSERT fail with a 500).
  @Column({ type: 'varchar', length: 50, nullable: true })
  category?: string | null;

  @Column({ name: 'logo_url', type: 'varchar', nullable: true })
  logoUrl?: string | null;

  /** Wide banner shown at the top of the store page (customer app). Optional. */
  @Column({ name: 'cover_image_url', type: 'varchar', nullable: true })
  coverImageUrl?: string | null;

  @Column({ name: 'commission_percent', type: 'numeric', precision: 5, scale: 2, default: 0 })
  commissionPercent: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => VendorBranch, (branch) => branch.vendor)
  branches: VendorBranch[];
}
