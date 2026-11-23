import { MigrationInterface, QueryRunner } from 'typeorm';
import { INITIAL_NEIGHBORHOOD_FEE_MINOR, LEGACY_ZONE_TRANSLATIONS } from '../../modules/delivery-zones/legacy-belbeis-neighborhood-translations';

/**
 * Zone -> one bilingual, independently-priced neighborhood/village per row.
 * Original zone ID, source areas JSON, fees and linked addresses are retained.
 * Every new leaf gets the owner's 15 EGP base fee. Order snapshots remain frozen.
 */
export class DeliveryZoneNeighborhoods1700009300000 implements MigrationInterface {
  name = 'DeliveryZoneNeighborhoods1700009300000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query([
      'ALTER TABLE "delivery_zones" ADD COLUMN "zone_name" varchar(150),',
      'ADD COLUMN "zone_name_ar" varchar(150),',
      'ADD COLUMN "is_selectable" boolean NOT NULL DEFAULT true;',
      'ALTER TABLE "delivery_zones" ADD CONSTRAINT "chk_delivery_zones_parent_pair"',
      'CHECK (("zone_name" IS NULL AND "zone_name_ar" IS NULL)',
      'OR ("zone_name" IS NOT NULL AND "zone_name_ar" IS NOT NULL',
      'AND length(btrim("zone_name")) > 0 AND length(btrim("zone_name_ar")) > 0));',
    ].join('\n'));
    const parents: Array<{
      id: string; service_area_id: string; name: string; name_ar: string;
      governorate: string; governorate_ar: string; city: string; city_ar: string;
      display_order: number; is_active: boolean; areas: string[];
    }> = await q.query([
      'SELECT id, service_area_id, name, name_ar, governorate, governorate_ar,',
      'city, city_ar, display_order, is_active, areas FROM delivery_zones',
      'WHERE deleted_at IS NULL AND jsonb_typeof(areas) = \'array\'',
      'AND jsonb_array_length(areas) > 0',
      'ORDER BY service_area_id, name_ar FOR UPDATE',
    ].join(' '));

    // Refuse missing, extra, duplicated or changed Arabic values. Never
    // guess pairing by comma positions; reject a stale translation inventory.
    const planned = parents.map((source) => {
      const translation = LEGACY_ZONE_TRANSLATIONS.find(
        (v) => v.parentAr === source.name_ar && v.parentEn === source.name,
      );
      if (!translation) throw new Error('Missing reviewed parent translation: ' + source.name_ar);
      if (!Array.isArray(source.areas) || source.areas.length !== translation.children.length) {
        throw new Error('Neighborhood count mismatch for parent: ' + source.name_ar);
      }
      const left = [...source.areas].sort();
      const right = translation.children.map((c) => c.nameAr).sort();
      if (left.some((name, i) => name !== right[i]) || new Set(left).size !== left.length) {
        throw new Error('Changed, duplicated or unmapped Arabic neighborhood in: ' + source.name_ar);
      }
      return { source, translation };
    });

    await q.query([
      'DROP INDEX IF EXISTS "UQ_delivery_zones_area_name_ar";',
      'DROP INDEX IF EXISTS "UQ_delivery_zones_area_name";',
      'CREATE UNIQUE INDEX "UQ_delivery_zones_area_name_ar"',
      'ON "delivery_zones" ("service_area_id", lower(coalesce("zone_name_ar", \'\')), lower("name_ar"))',
      'WHERE "deleted_at" IS NULL;',
      'CREATE UNIQUE INDEX "UQ_delivery_zones_area_name"',
      'ON "delivery_zones" ("service_area_id", lower(coalesce("zone_name", \'\')), lower("name"))',
      'WHERE "deleted_at" IS NULL;',
      'CREATE INDEX "IDX_delivery_zones_parent" ON "delivery_zones"',
      '("service_area_id", "zone_name_ar", "display_order") WHERE "deleted_at" IS NULL;',
    ].join('\n'));

    let created = 0;
    for (const { source, translation } of planned) {
      for (const [index, child] of translation.children.entries()) {
        await q.query([
          'INSERT INTO delivery_zones (service_area_id, governorate, governorate_ar, city, city_ar,',
          'name, name_ar, zone_name, zone_name_ar, delivery_fee_minor, display_order,',
          'is_active, is_selectable, areas)',
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,\'[]\'::jsonb)',
        ].join(' '), [
          source.service_area_id, source.governorate, source.governorate_ar,
          source.city, source.city_ar, child.name, child.nameAr,
          source.name, source.name_ar, INITIAL_NEIGHBORHOOD_FEE_MINOR,
          source.display_order + index + 1, source.is_active,
        ]);
        created++;
      }
      // Keep every original combined row, ID, fee, status and linked address.
      await q.query('UPDATE delivery_zones SET is_selectable = false WHERE id = $1', [source.id]);
    }
    await q.query(
      'UPDATE delivery_zones SET delivery_fee_minor = $1 WHERE zone_name IS NOT NULL AND is_selectable = true AND deleted_at IS NULL',
      [INITIAL_NEIGHBORHOOD_FEE_MINOR],
    );
    console.log('Bilingual neighborhood/village rows created at 15 EGP:', created);
  }

  public async down(q: QueryRunner): Promise<void> {
    const [{ count }] = await q.query(
      'SELECT count(*)::int AS count FROM delivery_zones WHERE zone_name IS NOT NULL OR is_selectable IS NOT TRUE',
    );
    if (Number(count) !== 0) {
      throw new Error('Data-preserving rollback required: cannot erase entered neighborhoods.');
    }
    await q.query([
      'DROP INDEX IF EXISTS "IDX_delivery_zones_parent";',
      'DROP INDEX IF EXISTS "UQ_delivery_zones_area_name_ar";',
      'DROP INDEX IF EXISTS "UQ_delivery_zones_area_name";',
      'CREATE UNIQUE INDEX "UQ_delivery_zones_area_name_ar"',
      'ON "delivery_zones" ("service_area_id", lower("name_ar")) WHERE "deleted_at" IS NULL;',
      'CREATE UNIQUE INDEX "UQ_delivery_zones_area_name"',
      'ON "delivery_zones" ("service_area_id", lower("name")) WHERE "deleted_at" IS NULL;',
      'ALTER TABLE "delivery_zones" DROP CONSTRAINT IF EXISTS "chk_delivery_zones_parent_pair";',
      'ALTER TABLE "delivery_zones" DROP COLUMN IF EXISTS "zone_name_ar",',
      'DROP COLUMN IF EXISTS "zone_name", DROP COLUMN IF EXISTS "is_selectable";',
    ].join('\n'));
  }
}
