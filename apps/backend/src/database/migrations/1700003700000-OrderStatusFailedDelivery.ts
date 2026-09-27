import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `FAILED_DELIVERY` to the `orders_status_enum` PostgreSQL type.
 *
 * `OrderStatus.FAILED_DELIVERY` (and the state-machine transitions,
 * failed-delivery resolution flow and `orders.failure_reason`/
 * `failed_at` columns built around it) shipped without any migration
 * ever adding the value to the database enum — every earlier migration
 * that touched `orders` left `orders_status_enum` at its original nine
 * values. Against a real PostgreSQL built purely from migrations, any
 * attempt to persist `status = 'FAILED_DELIVERY'` failed with
 * `invalid input value for enum orders_status_enum`, i.e. a driver
 * could not actually mark a delivery as failed. Unit tests could not
 * see this (they never touch a real enum type); the real-database
 * integration suite (enum round-trip) found it.
 *
 * `ADD VALUE IF NOT EXISTS` makes this safe on databases that already
 * received the value some other way (e.g. a schema once synchronized
 * from the entity). PostgreSQL cannot remove an enum value, so `down`
 * is deliberately a no-op: leaving an unused extra enum label is
 * harmless, whereas rebuilding the type would risk existing rows.
 */
export class OrderStatusFailedDelivery1700003700000 implements MigrationInterface {
  name = 'OrderStatusFailedDelivery1700003700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "orders_status_enum" ADD VALUE IF NOT EXISTS 'FAILED_DELIVERY'`);
  }

  public async down(): Promise<void> {
    // Intentionally empty — PostgreSQL has no ALTER TYPE ... DROP VALUE. See class comment.
  }
}
