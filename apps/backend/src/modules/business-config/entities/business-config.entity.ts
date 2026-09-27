import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Runtime-editable operational/business configuration — deliberately
 * separate from `config/configuration.ts` (deploy-time, env-var-backed,
 * requires a restart to change: secrets, connection strings). This
 * table is the "changeable by Operations/Admin without a deploy"
 * tier the approved architecture calls for.
 *
 * `value` is jsonb specifically so one generic store can hold a
 * boolean (the dispatch switch), a number, a string, or a structured
 * object for a future config key — without a schema change per key.
 * Known keys are cataloged in `business-config-key.enum.ts`, but this
 * table itself accepts any string key; the catalog is a convenience
 * for application code, not a DB-level constraint.
 */
@Entity({ name: 'business_config' })
export class BusinessConfig extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @Column({ type: 'varchar', nullable: true })
  description?: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'updated_by_user_id' })
  updatedBy?: User | null;

  @Column({ type: 'uuid', name: 'updated_by_user_id', nullable: true })
  updatedByUserId?: string | null;
}
