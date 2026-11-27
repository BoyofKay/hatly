import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Owner decision 2026-11-27: Hatly / Wasaly requests may carry a VOICE NOTE (up to 5 minutes) — text, photos and voice are each optional
 * (at least one is needed). It is kept on the cart item and frozen on the order item, so the driver and Operations can play it. Operations
 * can also write a note for the driver on the order. Additive.
 */
export class VoiceNotesAndDriverNote1700010200000 implements MigrationInterface {
  name = 'VoiceNotesAndDriverNote1700010200000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "voice_note_url" varchar(500) NULL`);
    await q.query(`ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "voice_note_url_snapshot" varchar(500) NULL`);
    await q.query(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "operations_note_for_driver" varchar(1000) NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "operations_note_for_driver"`);
    await q.query(`ALTER TABLE "order_items" DROP COLUMN IF EXISTS "voice_note_url_snapshot"`);
    await q.query(`ALTER TABLE "cart_items" DROP COLUMN IF EXISTS "voice_note_url"`);
  }
}
