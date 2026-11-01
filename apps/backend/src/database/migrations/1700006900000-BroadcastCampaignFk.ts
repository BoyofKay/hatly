import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `notification_broadcasts.campaign_id` was created (1700006700000) as a plain uuid. It is unused so far and always NULL, so a real foreign key
 * is safe to add now: deleting a campaign never deletes a broadcast, it only clears the link. ADDITIVE and reversible.
 */
export class BroadcastCampaignFk1700006900000 implements MigrationInterface {
  name = 'BroadcastCampaignFk1700006900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "notification_broadcasts" ADD CONSTRAINT "FK_notification_broadcasts_campaign" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "notification_broadcasts" DROP CONSTRAINT IF EXISTS "FK_notification_broadcasts_campaign"`);
  }
}
