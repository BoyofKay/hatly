import { writeFileSync } from 'fs';
import * as path from 'path';
import { AppDataSource } from '../database/data-source';
import { DEFAULT_MEDIA_DIR } from './seed-media';
import { DEMO_CATALOG } from './demo-marketplace/demo-catalog';
import { DemoImportReport, deactivateDemoRecords, listDemoRecords, runDemoImport } from './demo-marketplace/demo-marketplace';

/**
 * Demonstration marketplace importer — see ./demo-marketplace/demo-marketplace.ts for what it does and guarantees.
 *
 *   npm run demo:marketplace -- --dry-run                      (default) the full plan + report, nothing written
 *   DEMO_IMPORT_CONFIRM_DATABASE=<db> npm run demo:marketplace -- --execute --service-area "<name>"
 *   npm run demo:marketplace -- --report                       every record the importer created, and its state now
 *   DEMO_IMPORT_CONFIRM_DATABASE=<db> npm run demo:marketplace -- --deactivate-demo     takes the demo content off the app (deletes nothing)
 *
 * Options: --service-area <name|id>  --media-dir <dir>  --uploads-dir <dir>  --skip-images  --manifest <file.json>
 *
 * It is a standalone Node process (never an HTTP endpoint, never imported by the app, never run at application start). A WRITE needs the
 * database named EXACTLY in DEMO_IMPORT_CONFIRM_DATABASE, so it can never write to a database nobody meant it to.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function printReport(r: DemoImportReport): void {
  console.log(`\nDemo marketplace ${r.mode.toUpperCase()} — batch ${r.batch}, database "${r.database}"`);
  console.log(`Service area: ${r.serviceArea ? `${r.serviceArea.name} (${r.serviceArea.id})` : 'none'}`);
  for (const [type, byAction] of Object.entries(r.counts)) console.log(`  ${type.padEnd(22)} ${Object.entries(byAction).map(([a, n]) => `${a}=${n}`).join('  ')}`);
  const problems = r.items.filter((i) => i.action === 'CONFLICT' || i.action === 'DELETED_BY_ADMIN');
  for (const p of problems) console.log(`  ! ${p.action} ${p.demoKey}: ${p.reason ?? ''}`);
  if (r.missingImages.length) console.log(`  ${r.missingImages.length} image(s) not in the asset pack (placeholder shown): ${r.missingImages.slice(0, 5).join(', ')}${r.missingImages.length > 5 ? ', …' : ''}`);
  for (const e of r.errors) console.log(`  ERROR: ${e}`);
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const [{ current_database: database }]: Array<{ current_database: string }> = await AppDataSource.query('SELECT current_database()');
    console.log(`Connected database: "${database}"`);

    if (flag('report')) {
      const rows = await listDemoRecords(AppDataSource);
      const byType: Record<string, { total: number; missing: number; inactive: number }> = {};
      for (const r of rows) {
        const t = (byType[r.entityType] ??= { total: 0, missing: 0, inactive: 0 });
        t.total += 1;
        if (!r.exists) t.missing += 1;
        else if (r.active === false) t.inactive += 1;
      }
      console.table(byType);
      return;
    }

    const execute = flag('execute');
    const deactivate = flag('deactivate-demo');
    if ((execute || deactivate) && process.env.DEMO_IMPORT_CONFIRM_DATABASE !== database) {
      throw new Error(`Refusing to write: set DEMO_IMPORT_CONFIRM_DATABASE="${database}" to confirm this is the database you mean.`);
    }
    if (deactivate) {
      console.log(JSON.stringify(await deactivateDemoRecords(AppDataSource), null, 2));
      return;
    }

    const report = await runDemoImport(AppDataSource, DEMO_CATALOG, {
      mode: execute ? 'execute' : 'dry-run',
      database,
      serviceArea: arg('service-area'),
      mediaDir: path.resolve(arg('media-dir') ?? DEFAULT_MEDIA_DIR),
      uploadsDir: path.resolve(arg('uploads-dir') ?? process.env.UPLOADS_LOCAL_DIR ?? path.join(process.cwd(), 'uploads-storage')),
      skipImages: flag('skip-images'),
    });
    printReport(report);
    const manifest = arg('manifest');
    if (manifest) {
      writeFileSync(manifest, JSON.stringify(report, null, 2));
      console.log(`Manifest written: ${manifest}`);
    }
    if (report.errors.length > 0) process.exitCode = 1;
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
