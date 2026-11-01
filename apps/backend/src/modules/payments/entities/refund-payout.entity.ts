import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Operations' record that a Manual Transfer refund was ACTUALLY sent to the customer. The refund ledger event is an obligation
 * ("this much is owed back"); only a row here says the money moved. One row per refund event, never edited.
 */
@Entity({ name: 'refund_payouts' })
export class RefundPayout {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'financial_event_id', type: 'uuid', unique: true })
  financialEventId: string;

  @Column({ name: 'sent_by_user_id', type: 'uuid' })
  sentByUserId: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', default: () => 'now()' })
  sentAt: Date;
}
