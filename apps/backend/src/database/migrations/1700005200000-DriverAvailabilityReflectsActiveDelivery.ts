import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Data correction (Control Tower milestone). `drivers.is_available` means "has no active delivery" — set false at assignment
 * (DeliveryAssignmentService) and true again when the delivery ends or is released (OrderStateMachineService). But a new
 * driver was created with the column default `false` and nothing ever set it, so admin-created drivers could never be
 * dispatched. Driver creation now sets it; this realigns existing rows with the invariant: available ⇔ no delivery of theirs
 * is ASSIGNED_TO_DRIVER / PICKED_UP / ON_THE_WAY. Online status and verification are untouched (ranking still requires both).
 *
 * `down()` is intentionally a no-op: the previous values were the inconsistent state being corrected, not data to restore.
 */
export class DriverAvailabilityReflectsActiveDelivery1700005200000 implements MigrationInterface {
  name = 'DriverAvailabilityReflectsActiveDelivery1700005200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "drivers" d SET "is_available" = NOT EXISTS (
        SELECT 1 FROM "deliveries" dl JOIN "orders" o ON o."id" = dl."order_id"
        WHERE dl."driver_id" = d."id" AND o."status" IN ('ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY')
      );
    `);
  }

  public async down(): Promise<void> {
    // No-op — see the class comment.
  }
}
