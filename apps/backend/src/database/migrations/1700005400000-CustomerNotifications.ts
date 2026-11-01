import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer in-app notifications. ADDITIVE and reversible: one new table, no existing row or column changes.
 *
 *  - (order_id, type) is UNIQUE: each lifecycle event produces at most one notification per order, however many times it is
 *    retried or raced (the writer uses ON CONFLICT DO NOTHING).
 *  - (customer_id, created_at) serves the paginated list and the unread count of one customer.
 */
export class CustomerNotifications1700005400000 implements MigrationInterface {
  name = 'CustomerNotifications1700005400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "customer_notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "customer_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "type" varchar(40) NOT NULL,
        "order_number" varchar(20) NOT NULL,
        "is_read" boolean NOT NULL DEFAULT false,
        "read_at" timestamptz,
        CONSTRAINT "PK_customer_notifications_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customer_notifications_customer" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_customer_notifications_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_customer_notifications_read" CHECK (("is_read" = false AND "read_at" IS NULL) OR ("is_read" = true AND "read_at" IS NOT NULL))
      );
      CREATE UNIQUE INDEX "UQ_customer_notifications_order_type" ON "customer_notifications" ("order_id", "type");
      CREATE INDEX "IDX_customer_notifications_customer_created" ON "customer_notifications" ("customer_id", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "customer_notifications"`);
  }
}
