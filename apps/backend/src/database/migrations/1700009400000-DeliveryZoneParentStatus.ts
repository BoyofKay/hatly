import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeliveryZoneParentStatus1700009400000 implements MigrationInterface {
  name = 'DeliveryZoneParentStatus1700009400000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "delivery_zones" ADD COLUMN "parent_is_active" boolean NOT NULL DEFAULT true');
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "delivery_zones" DROP COLUMN "parent_is_active"');
  }
}
