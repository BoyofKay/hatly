import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marketing, campaigns and notification management (B2). ADDITIVE and reversible. NO discount arithmetic is introduced here: a campaign
 * only ORCHESTRATES existing offers/coupons (whose calculation, restoration and budget rules are unchanged) and Home banners, and a
 * broadcast only delivers a message. customer_notifications stays order-bound; broadcast messages use the new customer_inbox_messages.
 */
export class MarketingCampaigns1700006700000 implements MigrationInterface {
  name = 'MarketingCampaigns1700006700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audiences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(80) NOT NULL,
        "rules" jsonb NOT NULL DEFAULT '{}',
        "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "archived_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audiences" PRIMARY KEY ("id")
      );

      CREATE TABLE "notification_broadcasts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "campaign_id" uuid,
        "title_en" varchar(60) NOT NULL,
        "title_ar" varchar(60) NOT NULL,
        "body_en" varchar(240) NOT NULL,
        "body_ar" varchar(240) NOT NULL,
        "deep_link" varchar(200),
        "audience_id" uuid NOT NULL REFERENCES "audiences"("id"),
        "channels" text[] NOT NULL DEFAULT '{INBOX}',
        "status" varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','SCHEDULED','SENDING','COMPLETED','CANCELLED','FAILED')),
        "scheduled_at" timestamptz,
        "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "last_edited_by_user_id" uuid REFERENCES "users"("id"),
        "approved_by_user_id" uuid REFERENCES "users"("id"),
        "approved_at" timestamptz,
        "rejection_reason" varchar(300),
        "started_at" timestamptz,
        "finished_at" timestamptz,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_broadcasts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_broadcast_four_eyes" CHECK ("approved_by_user_id" IS NULL OR "approved_by_user_id" <> "created_by_user_id")
      );
      CREATE INDEX "IDX_broadcasts_status" ON "notification_broadcasts" ("status", "scheduled_at");

      CREATE TABLE "broadcast_recipients" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "broadcast_id" uuid NOT NULL REFERENCES "notification_broadcasts"("id") ON DELETE CASCADE,
        "customer_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "status" varchar(24) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','SENDING','SENT','FAILED','SKIPPED_NO_TOKEN','SKIPPED_CAP')),
        "attempts" smallint NOT NULL DEFAULT 0,
        "last_error" varchar(120),
        "sent_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_broadcast_recipients" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_broadcast_recipients" UNIQUE ("broadcast_id", "customer_user_id")
      );
      CREATE INDEX "IDX_broadcast_recipients_claim" ON "broadcast_recipients" ("broadcast_id", "status");

      CREATE TABLE "customer_inbox_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "customer_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "broadcast_id" uuid REFERENCES "notification_broadcasts"("id") ON DELETE SET NULL,
        "title_en" varchar(60) NOT NULL,
        "title_ar" varchar(60) NOT NULL,
        "body_en" varchar(240) NOT NULL,
        "body_ar" varchar(240) NOT NULL,
        "deep_link" varchar(200),
        "read_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_inbox_messages" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX "UQ_inbox_customer_broadcast" ON "customer_inbox_messages" ("customer_user_id", "broadcast_id") WHERE "broadcast_id" IS NOT NULL;
      CREATE INDEX "IDX_inbox_customer" ON "customer_inbox_messages" ("customer_user_id", "created_at" DESC);

      CREATE TABLE "coupon_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "offer_id" uuid NOT NULL REFERENCES "offers"("id"),
        "customer_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "granted_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "expires_at" timestamptz,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_coupon_grants" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_coupon_grants" UNIQUE ("offer_id", "customer_user_id")
      );

      CREATE TABLE "campaigns" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name_en" varchar(80) NOT NULL,
        "name_ar" varchar(80) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','SCHEDULED','RUNNING','COMPLETED','CANCELLED','FAILED')),
        "starts_at" timestamptz NOT NULL,
        "ends_at" timestamptz NOT NULL,
        "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "last_edited_by_user_id" uuid REFERENCES "users"("id"),
        "approved_by_user_id" uuid REFERENCES "users"("id"),
        "approved_at" timestamptz,
        "rejection_reason" varchar(300),
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_campaigns" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_campaign_window" CHECK ("ends_at" > "starts_at"),
        CONSTRAINT "CHK_campaign_four_eyes" CHECK ("approved_by_user_id" IS NULL OR "approved_by_user_id" <> "created_by_user_id")
      );
      CREATE INDEX "IDX_campaigns_status" ON "campaigns" ("status", "starts_at");

      CREATE TABLE "campaign_items" (
        "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
        "item_type" varchar(10) NOT NULL CHECK ("item_type" IN ('OFFER','BANNER','BROADCAST')),
        "item_id" uuid NOT NULL,
        "sort_order" smallint NOT NULL DEFAULT 0,
        "started_by_campaign" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_campaign_items" PRIMARY KEY ("campaign_id", "item_type", "item_id")
      );

      CREATE TABLE "campaign_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
        "from_status" varchar(20),
        "to_status" varchar(20) NOT NULL,
        "actor_user_id" uuid REFERENCES "users"("id"),
        "note" varchar(300),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_campaign_events" PRIMARY KEY ("id")
      );
      CREATE INDEX "IDX_campaign_events" ON "campaign_events" ("campaign_id", "created_at");

      ALTER TABLE "offers" ADD COLUMN "audience_id" uuid REFERENCES "audiences"("id"), ADD COLUMN "created_by_user_id" uuid REFERENCES "users"("id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "offers" DROP COLUMN "created_by_user_id", DROP COLUMN "audience_id";
      DROP TABLE "campaign_events";
      DROP TABLE "campaign_items";
      DROP TABLE "campaigns";
      DROP TABLE "coupon_grants";
      DROP TABLE "customer_inbox_messages";
      DROP TABLE "broadcast_recipients";
      DROP TABLE "notification_broadcasts";
      DROP TABLE "audiences";
    `);
  }
}
