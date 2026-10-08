import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * U2 (approved) — adds `COLLECTED` to `orders_status_enum`: a PICKUP order the customer collected at the branch.
 * Same shape as `OrderStatusFailedDelivery`: `ADD VALUE IF NOT EXISTS` is safe to re-run, and `down` is a no-op because
 * PostgreSQL cannot drop an enum value (an unused label is harmless; rebuilding the type would risk existing rows).
 */
export class OrderStatusCollected1700005300000 implements MigrationInterface {
  name = 'OrderStatusCollected1700005300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "orders_status_enum" ADD VALUE IF NOT EXISTS 'COLLECTED'`);
  }

  public async down(): Promise<void> {
    // Intentionally empty — PostgreSQL has no ALTER TYPE ... DROP VALUE. See class comment.
  }
}
