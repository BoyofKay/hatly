import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../users/entities/user.entity';
import { DeliveryZone } from '../../delivery-zones/entities/delivery-zone.entity';

/**
 * CONFIRMED business decision (Checkout / Address chunk): a genuinely
 * missing prerequisite, not a pre-existing model being extended — no
 * Address/ServiceArea system existed anywhere before this. Minimum
 * required shape only. `latitude`/`longitude` always come from the
 * device's own GPS at the moment the customer saved this address —
 * never fabricated (see AddressesService's own comment). `line1` is
 * the customer's own manually-typed/edited human-readable text — no
 * reverse geocoding exists in this codebase to derive it automatically.
 *
 * Deliberately NOT referenced by `Order` (no FK from Order to this
 * table) — see the migration's own comment for why this keeps the
 * existing `Order.deliveryAddressSnapshot` historical-snapshot
 * discipline entirely intact with zero changes elsewhere.
 */
@Entity({ name: 'addresses' })
export class Address extends BaseEntity {
  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Index()
  @Column({ name: 'customer_id' })
  customerId: string;

  /** e.g. "Home", "Work" — optional, purely for the customer's own list display. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  label?: string | null;

  @Column({ type: 'varchar', length: 255 })
  line1: string;

  /**
   * PD-009: the map pin is OPTIONAL (a pair — both or neither). When present it stays the authoritative location for the
   * existing coordinate serviceability + distance pricing; when absent, the selected Delivery Zone decides both.
   */
  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  /**
   * PD-009: the Delivery Zone the CUSTOMER selected. Required for every new/edited address; legacy rows keep NULL and are never
   * guessed into a zone.
   */
  @ManyToOne(() => DeliveryZone, { nullable: true })
  @JoinColumn({ name: 'delivery_zone_id' })
  deliveryZone?: DeliveryZone | null;

  @Index()
  @Column({ name: 'delivery_zone_id', type: 'uuid', nullable: true })
  deliveryZoneId: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  instructions?: string | null;

  /** Soft-deactivation, preferred over hard delete — matches this project's established soft-delete convention (BaseEntity.deletedAt) for the harder case. */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * Structured Egyptian address details (checkout address model). `line1` stays the human-readable summary the customer
   * confirmed; the coordinates are the authoritative location; `formattedAddress` is only the map provider's ASSISTIVE
   * suggestion, never the authoritative delivery address.
   */
  @Column({ type: 'varchar', length: 80, nullable: true })
  governorate?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  city?: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  street?: string | null;

  @Column({ name: 'building_number', type: 'varchar', length: 40, nullable: true })
  buildingNumber?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  floor?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  apartment?: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  landmark?: string | null;

  @Column({ name: 'formatted_address', type: 'varchar', length: 500, nullable: true })
  formattedAddress?: string | null;

  /** At most one default address per customer (partial unique index). */
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;
}
