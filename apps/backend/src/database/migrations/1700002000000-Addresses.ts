import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase G — Checkout / Address / Payment Verification chunk. CONFIRMED
 * business decision: Saved Addresses are a genuinely missing
 * prerequisite (no Address/ServiceArea model existed anywhere —
 * confirmed by direct inspection; `home/data/address_fixture.dart`
 * was a label-only UI stub with no coordinates). Minimum required
 * shape only: one row per customer-owned saved address, with GPS
 * coordinates (from the device, never fabricated) and a
 * customer-editable human-readable text field (no reverse geocoding
 * exists or is added here — see AddressesService's own comment).
 *
 * Deliberately NOT referenced by `Order` — `Order.deliveryAddressSnapshot`
 * (already existing) remains a plain jsonb copy of whichever address
 * fields were submitted at order-creation time, exactly as before this
 * chunk. A Saved Address is only ever a CONVENIENCE the customer picks
 * from at checkout to prefill that same existing raw
 * `deliveryAddress` object — never a live FK Order depends on — so
 * editing/deleting a saved address later can never retroactively
 * change a historical Order's snapshot; this is the existing snapshot
 * discipline working automatically, requiring zero changes to
 * `Order`/`OrderCreationService`/`CreateOrderDto`.
 */
export class Addresses1700002000000 implements MigrationInterface {
  name = 'Addresses1700002000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "addresses" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL REFERENCES "users"("id"),
        "label" varchar(100),
        "line1" varchar(255) NOT NULL,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "instructions" varchar(500),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_addresses_customer" ON "addresses" ("customer_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "addresses";
    `);
  }
}
