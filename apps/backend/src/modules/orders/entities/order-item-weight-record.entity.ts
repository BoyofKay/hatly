import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { OrderItem } from './order-item.entity';
import { Driver } from '../../delivery/entities/driver.entity';

/**
 * The historical source of truth for "what actual weight did an
 * authorized Vendor/Vendor Staff OR Driver record for this item" —
 * never a second, competing source alongside
 * `OrderItem.actualWeightGrams` (that column is only ever a
 * read-optimization cache of the CURRENT authoritative value — see
 * its own doc comment). Mirrors `AdHocPurchaseRecord`'s exact shape
 * and immutability discipline.
 *
 * Immutable by construction, not just convention: there is no update
 * method anywhere in `OrderItemWeightRecordService.record()` — a
 * second attempt for the same item is a hard rejection — and a unique
 * index on `order_item_id` (see the migration) makes it a DB-level
 * guarantee, not just an API-level one. This is the enforcement behind
 * "first authorized actor (Vendor OR Driver) to record wins; that
 * actor cannot edit or overwrite it."
 *
 * Exactly one of `recordedByUserId` / `recordedByDriverId` is ever
 * populated — a Vendor/Vendor Staff recorder is identified by their
 * User id (matching VendorStaffAuthorizationService's own
 * userId-based ownership check; there is no single "the VendorStaff
 * row" concept to point to when a user may manage more than one
 * branch), a Driver recorder by their Driver id (matching
 * AdHocPurchaseRecord's own convention). Enforced in
 * OrderItemWeightRecordService, application-level — same "nullable
 * XOR" convention already used elsewhere in this schema (e.g.
 * CartItem.productId/freeTextDescription).
 *
 * CONFIRMED (Admin authority decision): ADMIN plays no role in weight
 * or weighted-price entry/correction at all — there is no correction
 * mechanism anywhere in this codebase for this row. Once the first
 * authorized Vendor/Driver records it, this value is permanent, full
 * stop — not "immutable to Vendor/Driver but correctable by Admin."
 */
@Entity({ name: 'order_item_weight_records' })
export class OrderItemWeightRecord extends BaseEntity {
  @ManyToOne(() => OrderItem)
  @JoinColumn({ name: 'order_item_id' })
  orderItem: OrderItem;

  @Index({ unique: true })
  @Column({ name: 'order_item_id' })
  orderItemId: string;

  @Column({ name: 'weight_grams', type: 'int' })
  weightGrams: number;

  /** Populated only when a Vendor/Vendor Staff recorded this — the User id, per this file's own comment. */
  @Column({ type: 'uuid', name: 'recorded_by_user_id', nullable: true })
  recordedByUserId?: string | null;

  @ManyToOne(() => Driver, { nullable: true })
  @JoinColumn({ name: 'recorded_by_driver_id' })
  recordedByDriver?: Driver | null;

  /** Populated only when a Driver recorded this. */
  @Column({ type: 'uuid', name: 'recorded_by_driver_id', nullable: true })
  recordedByDriverId?: string | null;
}
