// Tests deploy/production/init-production-env.sh against the backend's REAL boot rules (collectEnvIssues from the compiled backend).
// Run: (cd apps/backend && npm run build) && node --test scripts/launch/test/production-env.test.mjs
// Every value used here is a dummy; the generated secrets live only in temp directories that are removed afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = join(root, 'deploy/production/init-production-env.sh');
const validatorPath = join(root, 'apps/backend/dist/src/config/env.validation.js');
const { collectEnvIssues } = createRequire(import.meta.url)(validatorPath);

const MAPS = 'AIzaSyDUMMY-dummy_key_for_tests_0123456789';
const FCM_KEY = '-----BEGIN PRIVATE KEY-----\\nMIIBdummy\\n-----END PRIVATE KEY-----\\n';

function run(input, { prepare } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hatly-prod-env-'));
  const out = join(dir, 'prod');
  if (prepare) prepare(out);
  const r = spawnSync('/bin/bash', [script], { input, env: { PATH: process.env.PATH, PROD_DIR: out }, encoding: 'utf8' });
  const file = join(out, '.env.production');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const res = { code: r.status, stdout: r.stdout, stderr: r.stderr, text, file, dir, out };
  return res;
}
const parse = (text) => Object.fromEntries(text.split('\n').filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const cleanup = (r) => rmSync(r.dir, { recursive: true, force: true });

test('Maps key given -> MAPS_PROVIDER=google + the key, accepted by the backend in production', () => {
  const r = run(`GOOGLE_MAPS_API_KEY=${MAPS}\n`);
  try {
    assert.equal(r.code, 0, r.stderr);
    const env = parse(r.text);
    const { errors, warnings } = collectEnvIssues(env);
    assert.deepEqual(errors, [], 'backend boot errors');
    assert.equal(env.NODE_ENV, 'production');
    assert.equal(env.MAPS_PROVIDER, 'google');
    assert.equal(env.GOOGLE_MAPS_API_KEY, MAPS);
    assert.equal(env.ALLOW_MISSING_SMS_PROVIDER, 'true');
    assert.equal(env.ALLOW_MISSING_PUSH_PROVIDER, 'true');
    assert.ok(warnings.some((w) => /SMS/.test(w)) && warnings.some((w) => /push/i.test(w)), 'missing providers are visible as warnings');
    // compose interpolation and the backend URLs share one password each
    assert.equal(new URL(env.DATABASE_URL).password, env.PROD_DB_PASSWORD);
    assert.equal(new URL(env.REDIS_URL).password, env.PROD_REDIS_PASSWORD);
    assert.equal(new URL(env.DATABASE_URL).pathname, `/${env.PROD_DB_NAME}`);
    assert.equal(new URL(env.DATABASE_URL).username, env.PROD_DB_USER);
    // secrets: present, long, all different, MFA key = 32 bytes
    const secrets = [env.PROD_DB_PASSWORD, env.PROD_REDIS_PASSWORD, env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET, env.MFA_ENCRYPTION_KEY];
    assert.equal(new Set(secrets).size, 5);
    assert.ok(secrets.every((s) => s.length >= 32));
    assert.equal(Buffer.from(env.MFA_ENCRYPTION_KEY, 'base64').length, 32);
    // file + folder are private; nothing secret was printed
    assert.equal(statSync(r.file).mode & 0o777, 0o600);
    assert.equal(statSync(r.out).mode & 0o777, 0o700);
    for (const s of [...secrets, MAPS]) assert.ok(!r.stdout.includes(s) && !r.stderr.includes(s), 'a secret value was printed');
    assert.ok(!/@@/.test(r.text));
  } finally { cleanup(r); }
});

test('full input (SMS + FCM) is written verbatim and accepted without warnings about providers', () => {
  const input = [`GOOGLE_MAPS_API_KEY=${MAPS}`, 'UNIFONIC_APP_SID=dummy-sid', 'UNIFONIC_SENDER_ID=Hatly',
    'FCM_PROJECT_ID=hatly-dummy', 'FCM_CLIENT_EMAIL=push@hatly-dummy.iam.gserviceaccount.com', `FCM_PRIVATE_KEY=${FCM_KEY}`].join('\n');
  const r = run(input);
  try {
    assert.equal(r.code, 0, r.stderr);
    const env = parse(r.text);
    assert.deepEqual(collectEnvIssues(env).errors, []);
    assert.equal(env.FCM_PRIVATE_KEY, FCM_KEY, 'the \\n escapes must survive untouched');
    assert.equal(env.ALLOW_MISSING_SMS_PROVIDER, undefined);
    assert.equal(env.ALLOW_MISSING_PUSH_PROVIDER, undefined);
    assert.ok(!r.stdout.includes('dummy-sid') && !r.stdout.includes('MIIBdummy'));
  } finally { cleanup(r); }
});

test('two runs never produce the same secrets', () => {
  const a = run(`GOOGLE_MAPS_API_KEY=${MAPS}\n`), b = run(`GOOGLE_MAPS_API_KEY=${MAPS}\n`);
  try { assert.notEqual(parse(a.text).JWT_ACCESS_SECRET, parse(b.text).JWT_ACCESS_SECRET); } finally { cleanup(a); cleanup(b); }
});

const refusals = [
  ['malformed Maps key', 'GOOGLE_MAPS_API_KEY=short\n'],
  ['only one Unifonic value', `GOOGLE_MAPS_API_KEY=${MAPS}\nUNIFONIC_APP_SID=x\n`],
  ['two of three FCM values', `GOOGLE_MAPS_API_KEY=${MAPS}\nFCM_PROJECT_ID=p\nFCM_CLIENT_EMAIL=a@p.iam.gserviceaccount.com\n`],
  ['FCM e-mail not a service account', `GOOGLE_MAPS_API_KEY=${MAPS}\nFCM_PROJECT_ID=p\nFCM_CLIENT_EMAIL=me@gmail.com\nFCM_PRIVATE_KEY=${FCM_KEY}\n`],
  ['a key that is not allowed', `GOOGLE_MAPS_API_KEY=${MAPS}\nTRUST_PROXY=true\n`],
  ['an injected extra variable via the value', `GOOGLE_MAPS_API_KEY=${MAPS}\nUNIFONIC_SENDER_ID=x\u0007\nUNIFONIC_APP_SID=y\n`],
  ['a duplicated key', `GOOGLE_MAPS_API_KEY=${MAPS}\nGOOGLE_MAPS_API_KEY=${MAPS}\n`],
  ['a line without =', `GOOGLE_MAPS_API_KEY=${MAPS}\nnonsense\n`],
  ['an empty value', `GOOGLE_MAPS_API_KEY=${MAPS}\nUNIFONIC_APP_SID=\nUNIFONIC_SENDER_ID=y\n`],
];
for (const [name, input] of refusals) {
  test(`refuses: ${name} — and writes nothing`, () => {
    const r = run(input);
    try {
      assert.notEqual(r.code, 0);
      assert.match(r.stderr, /REFUSING/);
      assert.equal(r.text, null, 'no env file may be left behind');
      assert.ok(!r.stderr.includes(MAPS), 'the Maps key must not be echoed');
    } finally { cleanup(r); }
  });
}

test('refuses to overwrite an existing env file (and leaves it untouched)', () => {
  const r = run(`GOOGLE_MAPS_API_KEY=${MAPS}\n`, {
    prepare: (out) => { spawnSync('mkdir', ['-p', out]); writeFileSync(join(out, '.env.production'), 'EXISTING=1\n'); },
  });
  try {
    assert.notEqual(r.code, 0);
    assert.equal(r.text, 'EXISTING=1\n');
  } finally { cleanup(r); }
});

test('NO operator input at all -> MAPS_PROVIDER=none (PD-009 G), no key, no SMS/push — accepted by the backend in production with warnings', () => {
  const r = run('');
  try {
    assert.equal(r.code, 0, r.stderr);
    const env = parse(r.text);
    assert.equal(env.MAPS_PROVIDER, 'none');
    assert.equal(env.GOOGLE_MAPS_API_KEY, undefined);
    const { errors, warnings } = collectEnvIssues(env);
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => /MAPS_PROVIDER=none/.test(w)), 'Maps-disabled mode is visible as a warning');
    assert.match(r.stdout, /Maps: none \(deferred\)/);
  } finally { cleanup(r); }
});

test('SMS only (no Maps key) -> MAPS_PROVIDER=none with the SMS provider configured', () => {
  const r = run('UNIFONIC_APP_SID=dummy-sid\nUNIFONIC_SENDER_ID=Hatly\n');
  try {
    assert.equal(r.code, 0, r.stderr);
    const env = parse(r.text);
    assert.equal(env.MAPS_PROVIDER, 'none');
    assert.equal(env.ALLOW_MISSING_SMS_PROVIDER, undefined);
    assert.deepEqual(collectEnvIssues(env).errors, []);
  } finally { cleanup(r); }
});

test('the template alone (no generator) is incomplete: without MAPS_PROVIDER it means google, which needs a key', () => {
  const env = parse(readFileSync(join(root, 'deploy/production/env.production.template'), 'utf8'));
  const { errors } = collectEnvIssues(env);
  assert.ok(errors.some((e) => /GOOGLE_MAPS_API_KEY/.test(e)));
});
