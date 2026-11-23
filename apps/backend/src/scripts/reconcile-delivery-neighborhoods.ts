import { readFileSync } from 'fs';
import { AppDataSource } from '../database/data-source';
import { DeliveryZone } from '../modules/delivery-zones/entities/delivery-zone.entity';

/**
 * Inventory by default (NO WRITES). To reconcile older combined rows:
 * provide reviewed bilingual child pairs and each child's explicit fee.
 * Never automatically split or translate combined Arabic/English labels.
 *
 * DELIVERY_NEIGHBORHOOD_MAPPING_FILE = path to a JSON array like:
 * [{"sourceZoneId":"<uuid>","existingName":"<original English>",
 *   "existingNameAr":"<original Arabic>","zoneName":"<parent EN>",
 *   "zoneNameAr":"<parent AR>","children":[
 *     {"name":"<one EN>","nameAr":"<one AR>","deliveryFeeMinor":1500}]}]
 *
 * Apply requires both:
 * DELIVERY_NEIGHBORHOOD_APPLY=YES_PRESERVE_LEGACY
 * DELIVERY_NEIGHBORHOOD_ALLOW_DATABASE=<exact current database name>
 * Never invoked by deployment. Execute only after a backup and manual review.
 */
type Child = { name: string; nameAr: string; deliveryFeeMinor: number };
type Mapping = {
  sourceZoneId: string; existingName: string; existingNameAr: string;
  zoneName: string; zoneNameAr: string; children: Child[];
};
function oneName(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 150 || /[,،;|\r\n]/.test(v))
    throw new Error(field + ': enter exactly one non-empty name, not a list');
  return v.trim();
}
function parseMapping(raw: unknown): Mapping[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error('Mapping must be a nonempty JSON array');
  const ids = new Set<string>();
  return raw.map((value, i) => {
    const m = value as Partial<Mapping>;
    if (typeof m.sourceZoneId !== 'string' || !/^[0-9a-f-]{36}$/i.test(m.sourceZoneId) || ids.has(m.sourceZoneId))
      throw new Error('Invalid/duplicate sourceZoneId at entry ' + i);
    ids.add(m.sourceZoneId);
    if (typeof m.existingName !== 'string' || typeof m.existingNameAr !== 'string')
      throw new Error('Supply the EXACT old bilingual labels for entry ' + i);
    if (!Array.isArray(m.children) || !m.children.length) throw new Error('Children missing at entry ' + i);
    const children = m.children.map((c, j) => {
      const name = oneName(c?.name, 'English child ' + j);
      const nameAr = oneName(c?.nameAr, 'Arabic child ' + j);
      if (!Number.isSafeInteger(c?.deliveryFeeMinor) || c.deliveryFeeMinor < 0 || c.deliveryFeeMinor > 10000000)
        throw new Error('Explicit fee in minor units required for child ' + j);
      return { name, nameAr, deliveryFeeMinor: c.deliveryFeeMinor };
    });
    if (new Set(children.map(c => c.name.toLowerCase())).size !== children.length ||
        new Set(children.map(c => c.nameAr.toLowerCase())).size !== children.length)
      throw new Error('Duplicate child name at entry ' + i);
    return {
      sourceZoneId: m.sourceZoneId, existingName: m.existingName,
      existingNameAr: m.existingNameAr, zoneName: oneName(m.zoneName, 'Parent EN'),
      zoneNameAr: oneName(m.zoneNameAr, 'Parent AR'), children,
    };
  });
}
async function main(): Promise<void> {
  const apply = process.env.DELIVERY_NEIGHBORHOOD_APPLY === 'YES_PRESERVE_LEGACY';
  if (process.env.DELIVERY_NEIGHBORHOOD_APPLY && !apply) throw new Error('Unknown apply flag');
  const file = process.env.DELIVERY_NEIGHBORHOOD_MAPPING_FILE;
  const mappings = file ? parseMapping(JSON.parse(readFileSync(file, 'utf8'))) : [];
  await AppDataSource.initialize();
  try {
    const [{ db }] = await AppDataSource.query('SELECT current_database() AS db');
    const inventory = await AppDataSource.query([
      'SELECT z.id, z.service_area_id AS "serviceAreaId", z.name, z.name_ar AS "nameAr",',
      'z.zone_name AS "zoneName", z.zone_name_ar AS "zoneNameAr",',
      'z.delivery_fee_minor::int AS "deliveryFeeMinor", z.is_active AS "isActive",',
      'z.is_selectable AS "isSelectable",',
      '(SELECT count(*)::int FROM addresses a WHERE a.delivery_zone_id = z.id) AS "linkedAddresses"',
      'FROM delivery_zones z WHERE z.deleted_at IS NULL ORDER BY z.city_ar, z.name_ar',
    ].join(' '));
    console.log(JSON.stringify({ database: db, mode: apply ? 'PREFLIGHT' : 'READ_ONLY', inventory }, null, 2));
    if (!apply) return;
    if (!file || !mappings.length) throw new Error('A reviewed mapping file is mandatory');
    if (process.env.DELIVERY_NEIGHBORHOOD_ALLOW_DATABASE !== db)
      throw new Error('Database not explicitly allow-listed. No changes made.');
    await AppDataSource.transaction(async (manager) => {
      const zones = manager.getRepository(DeliveryZone);
      for (const m of mappings) {
        const old = await zones.findOne({ where: { id: m.sourceZoneId }, lock: { mode: 'pessimistic_write' } });
        if (!old || old.deletedAt || !old.isSelectable || old.zoneName || old.zoneNameAr ||
            old.name !== m.existingName || old.nameAr !== m.existingNameAr)
          throw new Error('Legacy row changed since review: ' + m.sourceZoneId);
        if (m.children.length === 1 && old.name === m.children[0].name &&
            old.nameAr === m.children[0].nameAr &&
            Number(old.deliveryFeeMinor) === m.children[0].deliveryFeeMinor) {
          // Existing one-child row: preserve its ID, fee, names and saved addresses.
          old.zoneName = m.zoneName;
          old.zoneNameAr = m.zoneNameAr;
          await zones.save(old);
          continue;
        }
        // A combined row is retained untouched for existing addresses and order history.
        // New children get individual records and fees. Old combined selection is hidden.
        for (let i = 0; i < m.children.length; i++) {
          const c = m.children[i];
          const duplicate = await zones.findOne({
            where: { serviceAreaId: old.serviceAreaId, zoneName: m.zoneName, name: c.name },
          });
          if (duplicate) throw new Error('Child already exists under this parent: ' + c.name);
          await zones.save(zones.create({
            serviceAreaId: old.serviceAreaId, governorate: old.governorate,
            governorateAr: old.governorateAr, city: old.city, cityAr: old.cityAr,
            zoneName: m.zoneName, zoneNameAr: m.zoneNameAr,
            name: c.name, nameAr: c.nameAr, deliveryFeeMinor: c.deliveryFeeMinor,
            displayOrder: old.displayOrder + i + 1, isActive: old.isActive, isSelectable: true,
            representativeLatitude: null, representativeLongitude: null,
          }));
        }
        old.isSelectable = false;
        await zones.save(old);
      }
    });
    console.log('Applied atomically. Original rows, fees, IDs and address links were preserved.');
  } finally {
    await AppDataSource.destroy();
  }
}
main().catch(error => {
  console.error('Reconciliation refused:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
