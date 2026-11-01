/**
 * The owner-run Staging script `deploy/staging/post-update-auth-checks.sh`, executed UNMODIFIED against the real application (real HTTP, real
 * PostgreSQL/Redis) through its loopback-only rehearsal switch. It exists because the first Staging run of that script reported four failures
 * that were all wrong expectations in the script (401 vs 403 on customer routes for a signed-in staff session, and logout sent the CSRF token
 * instead of the custom header). If the backend contract and the script ever disagree again, this test fails before the owner has to find out.
 * The credentials in the temporary file are this harness's own test admin — no real secret is involved.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bootWorld, World } from './support/world';
import { Scenario, DEFAULT_PASSWORD } from './support/actors';

const SCRIPT = path.resolve(__dirname, '../../../../deploy/staging/post-update-auth-checks.sh');

describe('E2E — owner auth-check script (rehearsal against the real app)', () => {
  let world: World;
  let s: Scenario;
  let tmp: string;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hatly-auth-checks-'));
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      await world.close();
    }
  });

  // async on purpose: the application under test runs in THIS process, so a blocking spawnSync would starve it of the event loop
  const run = (env: Record<string, string>) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn('bash', [SCRIPT], { env: { PATH: process.env.PATH ?? '', HOME: tmp, ...env } });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', reject);
      child.on('close', (status) => {
        clearTimeout(timer);
        resolve({ status, stdout, stderr });
      });
    });

  it('passes every check against the real backend, prints no credential, and writes exactly one sign-in and one sign-out', async () => {
    const admin = await s.superAdmin();
    // Staging has sectors; the empty e2e database needs one for the script's "/sectors carries customRequestsEnabled" check to have a row to look at
    expect((await world.api('post', '/admin/sectors', { token: admin.accessToken, body: { name: 'Rehearsal sector', slug: `rehearsal-${Date.now()}` } })).status).toBe(201);
    const credentials = path.join(tmp, 'credentials');
    fs.writeFileSync(credentials, `SALES_ADMIN_PHONE=${admin.phone}\nSALES_ADMIN_PASSWORD=${DEFAULT_PASSWORD}\nTESTER_PASSWORD=unused\n`, { mode: 0o600 });

    const res = await run({ AUTH_CHECKS_LOCAL_REHEARSAL: '1', STAGING_API: `${world.baseUrl}/api/v1`, AUTH_CHECKS_CREDENTIALS_FILE: credentials });
    const out = `${res.stdout}\n${res.stderr}`;
    expect({ status: res.status, failures: out.split('\n').filter((l) => l.startsWith('FAIL')) }).toEqual({ status: 0, failures: [] });
    expect(out).toContain('ALL AUTH CHECKS PASSED');
    for (const expected of [
      'POST /auth/dashboard/logout with X-Requested-With = 200',
      'refused for = CSRF_HEADER_REQUIRED',
      'GET /customer/notifications, staff session = 403',
      'refused for = CSRF_TOKEN_INVALID',
      'POST /auth/dashboard/refresh with the PRE-logout refresh cookie (server-side revocation) = 401',
    ]) expect(out).toContain(expected);
    expect(out).not.toContain(DEFAULT_PASSWORD);
    expect(out).not.toContain(admin.phone);

    // exactly one sign-in and one sign-out were written for the admin, and no customer data changed
    const actions = (await world.ds.query('SELECT action FROM admin_audit_logs WHERE actor_user_id = $1 ORDER BY created_at, id', [admin.id])).map((r: any) => r.action);
    expect(actions.filter((a: string) => a === 'auth.dashboard_login')).toHaveLength(1);
    expect(actions.filter((a: string) => a === 'auth.dashboard_logout')).toHaveLength(1);
  });

  it('refuses every target that is not the Staging API or an explicitly requested loopback rehearsal', async () => {
    const credentials = path.join(tmp, 'credentials-unused');
    fs.writeFileSync(credentials, 'SALES_ADMIN_PHONE=+201000000000\nSALES_ADMIN_PASSWORD=x\n');
    const cases: Array<[string, Record<string, string>]> = [
      ['a production-like API', { STAGING_API: 'https://api.hatly.dev/api/v1' }],
      ['a loopback API without the rehearsal switch', { STAGING_API: `${world.baseUrl}/api/v1`, AUTH_CHECKS_CREDENTIALS_FILE: credentials }],
      ['the rehearsal switch with a non-loopback API', { AUTH_CHECKS_LOCAL_REHEARSAL: '1', STAGING_API: 'https://api.hatly.dev/api/v1', AUTH_CHECKS_CREDENTIALS_FILE: credentials }],
      ['the rehearsal switch with a look-alike host', { AUTH_CHECKS_LOCAL_REHEARSAL: '1', STAGING_API: 'http://127.0.0.1.evil.example:80/api/v1', AUTH_CHECKS_CREDENTIALS_FILE: credentials }],
      ['the rehearsal switch with a userinfo trick (host is evil.example)', { AUTH_CHECKS_LOCAL_REHEARSAL: '1', STAGING_API: 'http://127.0.0.1:80@evil.example/api/v1', AUTH_CHECKS_CREDENTIALS_FILE: credentials }],
    ];
    for (const [label, env] of cases) {
      const res = await run(env);
      expect({ label, status: res.status, refused: /REFUSING/.test(res.stdout) }).toEqual({ label, status: 2, refused: true });
    }
  });
});
