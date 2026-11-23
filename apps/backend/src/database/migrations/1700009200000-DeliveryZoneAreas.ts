import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Owner decision 2026-11-23: two levels — delivery zone → villages / neighbourhoods (`delivery_zones.areas`, the customer picks one; the
 * fee is the zone's). Loads Belbeis officially (sharkia.gov.eg administrative division: 9 units + their villages) plus Belbeis City with
 * its neighbourhoods, each at 15 EGP until changed in the admin panel. Added to the service area that already has zones in Belbeis (or the
 * only active service area); skipped when there is none or a zone of the same Arabic name already exists. Additive.
 */
const BELBEIS = [{"name": "Belbeis City", "nameAr": "مدينة بلبيس", "areas": ["حي الزهور", "حي النادي", "حي علوان", "المنطقة الصناعية", "حي أبو نصيب", "حي سعدون", "حي المنشية", "حي المركز", "حي السوق القديم", "حي السوق", "حي المركز الطبي", "حي المحطة", "حي الساحة", "حي الكلية الجوية", "حي المطحن", "حي الثانوي العسكرية", "حي المساكن الجديدة", "حي المحكمة القديمة", "حي المحكمة الجديدة", "وسط البلد", "حي المتاجر الشعبية", "الشارع الجديد", "الشارع القديم", "حي المظلوم", "حي رب العالمين"]}, {"name": "Kafr Ayoub Soliman", "nameAr": "كفر أيوب سليمان", "areas": ["كفر أيوب سليمان", "الكتيبة", "السعادات", "بساتين سراج الدين", "الطحاوية"]}, {"name": "Kafr Ibrahim El-Aydy", "nameAr": "كفر إبراهيم العايدي", "areas": ["الكفر القديم", "كفر إبراهيم العايدي", "كفر بني عليم", "منية سنتا"]}, {"name": "El-Balashon", "nameAr": "البلاشون", "areas": ["البلاشون", "ميت جابر", "بني صالح", "قرملة", "منشأة السلام", "كفر مسعود حجازي", "ميت معلا", "كفر حفنا"]}, {"name": "Awlad Seif", "nameAr": "أولاد سيف", "areas": ["أولاد سيف", "أولاد مهنا", "ميت ربيعة البيضا", "نوبة الدهاشنة", "كفر الشيخ عيسى", "المنشية", "الروضة", "العرايشية", "حوض الندى"]}, {"name": "El-Adleya", "nameAr": "العدلية", "areas": ["العدلية", "ميت حمل", "الشغانبة", "ميت حبيب", "كفر أكياد", "سندنهور", "قهلة الجبلة", "كفر العرب"]}, {"name": "Ghita", "nameAr": "غيتة", "areas": ["غيتة", "السلام", "تل روزن", "الشولية"]}, {"name": "El-Zawamel", "nameAr": "الزوامل", "areas": ["الزوامل", "بساتين الإسماعيلية", "منية سلمنت"]}, {"name": "Anshas El-Raml", "nameAr": "أنشاص الرمل", "areas": ["أنشاص الرمل", "سلمنت", "بير عمارة", "السعيدية"]}, {"name": "Shubra El-Nakhla", "nameAr": "شبرا النخلة", "areas": ["شبرا النخلة", "حفنا", "الجوسق", "العبسي"]}] as Array<{ name: string; nameAr: string; areas: string[] }>;

export class DeliveryZoneAreas1700009200000 implements MigrationInterface {
  name = 'DeliveryZoneAreas1700009200000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "delivery_zones" ADD COLUMN IF NOT EXISTS "areas" jsonb NOT NULL DEFAULT '[]'::jsonb`);
    const [ref] = await q.query(
      `SELECT z.service_area_id, z.governorate, z.governorate_ar, z.city, z.city_ar FROM delivery_zones z
        WHERE z.city_ar LIKE '%بلبيس%' OR z.city ILIKE '%belb%' OR z.city ILIKE '%bilb%' ORDER BY z.created_at LIMIT 1`,
    );
    let area = ref?.service_area_id as string | undefined;
    if (!area) {
      const actives = await q.query(`SELECT id FROM service_areas WHERE is_active AND deleted_at IS NULL`).catch(() => []);
      if (actives.length === 1) area = actives[0].id;
    }
    if (!area) return; // nothing to attach to (e.g. a fresh test database)
    let order = 100;
    for (const z of BELBEIS) {
      const [exists] = await q.query(`SELECT id FROM delivery_zones WHERE service_area_id = $1 AND name_ar = $2`, [area, z.nameAr]);
      if (exists) {
        await q.query(`UPDATE delivery_zones SET areas = $2::jsonb WHERE id = $1 AND areas = '[]'::jsonb`, [exists.id, JSON.stringify(z.areas)]);
        continue;
      }
      await q.query(
        `INSERT INTO delivery_zones (service_area_id, governorate, governorate_ar, city, city_ar, name, name_ar, delivery_fee_minor, display_order, is_active, areas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1500, $8, true, $9::jsonb)`,
        [area, ref?.governorate ?? 'Sharqia', ref?.governorate_ar ?? 'الشرقية', ref?.city ?? 'Belbeis', ref?.city_ar ?? 'بلبيس', z.name, z.nameAr, order++, JSON.stringify(z.areas)],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "delivery_zones" DROP COLUMN IF EXISTS "areas"`);
  }
}
