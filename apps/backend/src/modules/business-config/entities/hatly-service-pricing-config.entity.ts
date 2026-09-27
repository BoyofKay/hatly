import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * PLACEHOLDER SCAFFOLD — NOT A PRICING FORMULA.
 *
 * Reserves a place for the future ad-hoc "Hatly Service" pricing rule
 * (unregistered-vendor orders — pharmacies, vegetable shops, etc. —
 * per the Multi-Vendor report's §9, still not built). The exact
 * pricing mechanism is an explicitly OPEN business decision (see the
 * Phase 2 report) — `config` is deliberately an opaque, uninterpreted
 * jsonb blob. No code anywhere reads or validates its internal shape
 * yet; this table exists so a future pricing module has somewhere to
 * write to without a schema migration blocking that decision.
 *
 * Modeled as a single current-config row (service always
 * gets-or-creates one row, see hatly-service-pricing.service.ts)
 * rather than multiple keyed rows like BusinessConfig — pricing
 * config is a single evolving ruleset, not a set of independent flags.
 */
@Entity({ name: 'hatly_service_pricing_config' })
export class HatlyServicePricingConfig extends BaseEntity {
  @Column({ type: 'jsonb', nullable: true })
  config?: unknown | null;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'updated_by_user_id' })
  updatedBy?: User | null;

  @Column({ type: 'uuid', name: 'updated_by_user_id', nullable: true })
  updatedByUserId?: string | null;
}
