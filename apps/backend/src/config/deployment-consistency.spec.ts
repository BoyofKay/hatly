import * as fs from 'fs';
import * as path from 'path';
import { REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE } from '../modules/auth/dashboard-session';

/**
 * Release-readiness guards for facts that only break at deploy time (the Docker image is not built in the unit-test environment):
 *
 * 1. Staging image: `npm ci --omit=dev` nests packages whose version differs from the hoisted copy under
 *    `apps/backend/node_modules` (after the firebase-admin 14 upgrade: firebase-admin itself and its @google-cloud/@firebase chain).
 *    The runtime stage must copy that directory too, otherwise the compiled backend dies at boot with MODULE_NOT_FOUND
 *    ('firebase-admin/app', imported eagerly by the push provider).
 * 2. The Node major the project requires (`engines`) is the one CI and every Dockerfile use.
 * 3. `start:prod` and the Dockerfile CMD point at the file `nest build` really emits (`dist/src/main`).
 * 5. The process handles SIGTERM (`docker stop`) through Nest's shutdown hooks. Measured on the compiled backend: with the hook the Redis client
 *    is quit on SIGTERM, without it the signal kills the process and none of the OnApplicationShutdown/OnModuleDestroy code runs.
 * 6. The owner-run Staging auth-check script speaks the backend's real session contract (its first Staging run failed 4 checks on wrong
 *    expectations; the behavioural proof is e2e 102, this is the cheap guard that runs everywhere).
 * 4. The dashboard has the PostCSS config Tailwind needs (without it every build ships a ~100-byte, unstyled stylesheet).
 */
const repoRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

describe('deployment consistency', () => {
  const backendDockerfile = read('deploy/staging/backend.Dockerfile');

  it('the lockfile really nests production packages under apps/backend/node_modules (the premise of the image guard below)', () => {
    const lock = JSON.parse(read('package-lock.json')).packages as Record<string, { dev?: boolean }>;
    const nestedProd = Object.entries(lock).filter(([key, value]) => key.startsWith('apps/backend/node_modules/') && !value.dev);
    // If this ever becomes empty the guard below is moot and may be removed deliberately.
    expect(nestedProd.length).toBeGreaterThan(0);
    expect(Object.keys(lock)).toContain('apps/backend/node_modules/firebase-admin');
  });

  it('the staging backend image runtime stage copies BOTH the hoisted and the workspace-nested production node_modules', () => {
    const runtime = backendDockerfile.slice(backendDockerfile.indexOf('AS runtime'));
    expect(runtime).toMatch(/COPY --from=prod-deps \/repo\/node_modules \/repo\/node_modules/);
    expect(runtime).toMatch(/COPY --from=prod-deps \/repo\/apps\/backend\/node_modules \.\/node_modules/);
  });

  it('CI and every Dockerfile use the Node major the project requires', () => {
    const engines: string = JSON.parse(read('package.json')).engines.node;
    const required = Number(/>=\s*(\d+)/.exec(engines)?.[1]);
    expect(required).toBeGreaterThanOrEqual(22);

    const ci = read('.github/workflows/ci.yml');
    const ciVersions = [...ci.matchAll(/node-version:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(ciVersions.length).toBeGreaterThan(0);
    for (const version of ciVersions) expect(version).toBe(required);

    for (const dockerfile of ['deploy/staging/backend.Dockerfile', 'deploy/staging/dashboard.Dockerfile']) {
      const images = [...read(dockerfile).matchAll(/^FROM node:(\d+)/gm)].map((m) => Number(m[1]));
      expect(images.length).toBeGreaterThan(0);
      for (const major of images) expect(major).toBe(required);
    }
  });

  it('start:prod and the image CMD run the entry point that nest build emits', () => {
    const scripts = JSON.parse(read('apps/backend/package.json')).scripts as Record<string, string>;
    expect(scripts['start:prod']).toBe('node dist/src/main');
    expect(backendDockerfile).toMatch(/CMD \["node", "dist\/src\/main\.js"\]/);
  });

  it('the dashboard has a PostCSS config that runs Tailwind (otherwise its pages render unstyled)', () => {
    const config = read('apps/dashboard/postcss.config.js');
    expect(config).toMatch(/tailwindcss/);
    expect(config).toMatch(/autoprefixer/);
    expect(read('deploy/staging/dashboard.Dockerfile')).toMatch(/test -f apps\/dashboard\/postcss\.config\.js/);
  });

  it('the backend entry point enables Nest shutdown hooks so SIGTERM (docker stop) runs the Redis/throttler/dispatch shutdown code', () => {
    const main = read('apps/backend/src/main.ts');
    expect(main).toMatch(/app\.enableShutdownHooks\(\);/);
    // after the app is created and configured, before it starts listening
    expect(main.indexOf('enableShutdownHooks')).toBeGreaterThan(main.indexOf('configureApp(app)'));
    expect(main.indexOf('enableShutdownHooks')).toBeLessThan(main.indexOf('app.listen'));
  });

  it('the owner-run Staging auth-check script uses the backend\'s logout header and 401/403 contract, and only ever targets Staging or a loopback rehearsal', () => {
    const script = read('deploy/staging/post-update-auth-checks.sh');
    // logout (and the refresh replay) authenticate by the custom header the backend defines — not by the CSRF token
    const header = `${REQUESTED_WITH_HEADER.replace(/(^|-)(\w)/g, (_m, dash, ch) => dash + ch.toUpperCase())}: ${REQUESTED_WITH_VALUE}`;
    expect(script).toContain(`REQUESTED_WITH='${header}'`);
    expect(script).toMatch(/logout with X-Requested-With" "\$\(code -X POST -H "\$REQUESTED_WITH"/);
    expect(script).toMatch(/refresh with the PRE-logout refresh cookie[\s\S]*-H "\$REQUESTED_WITH"[\s\S]*\)" 401/);
    // customer-only routes: anonymous 401, a signed-in staff session 403 (never 401 for an authenticated caller)
    expect(script).toMatch(/GET \/customer\/notifications, no session" .* 401/);
    expect(script).toMatch(/GET \/customer\/notifications, staff session" "\$STATUS" 403/);
    expect(script).toMatch(/delete-account, staff cookie WITHOUT X-CSRF-Token" "\$STATUS" 403/);
    expect(script).toMatch(/delete-account, staff cookie WITH a valid X-CSRF-Token" "\$STATUS" 403/);
    // the target guard: Staging only, loopback only behind an explicit switch, and never a production host
    expect(script).toMatch(/https:\/\/api-sales\.hatly\.dev\/\*\) ;;/);
    expect(script).toMatch(/AUTH_CHECKS_LOCAL_REHEARSAL:-\}" = 1/);
    expect(script).not.toMatch(/https:\/\/api\.hatly\.dev/);
  });
});
