import * as fs from 'fs';
import * as path from 'path';

/** Names of every class declared with `@Entity` anywhere under src/ — the ground truth the DataSource must agree with. */
export function entityClassNamesOnDisk(): string[] {
  const names: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.entity.ts')) {
        const source = fs.readFileSync(full, 'utf8');
        const m = source.match(/^@Entity\([^\n]*\)\s*\n(?:@[^\n]*\n)*(?:export )?class (\w+)/m);
        if (m) names.push(m[1]);
      }
    }
  };
  walk(path.join(__dirname, '..', '..', '..', 'src'));
  return names.sort();
}
