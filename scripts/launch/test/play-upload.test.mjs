// Tests scripts/launch/play-upload.mjs against a LOCAL mock of Google's token endpoint and the Play Developer API (no network, throw-away key).
// Run: node --test scripts/launch/test/play-upload.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync, createVerify, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'play-upload.mjs');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const dir = mkdtempSync(join(tmpdir(), 'hatly-play-'));
const keyFile = join(dir, 'sa.json');
writeFileSync(keyFile, JSON.stringify({ type: 'service_account', client_email: 'uploader@hatly-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
chmodSync(keyFile, 0o600);
const aab = join(dir, 'app-release.aab');
writeFileSync(aab, Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(2048, 7)]));
const aabSha = createHash('sha256').update(Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(2048, 7)])).digest('hex');
const notesDir = join(dir, 'notes'); mkdirSync(notesDir);
writeFileSync(join(notesDir, 'ar.txt'), 'أول إصدار من تطبيق هاتلي.');
writeFileSync(join(notesDir, 'en-US.txt'), 'First release of the Hatly app.');

function mock({ reportSha } = {}) {
  const calls = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/token') {
        const assertion = new URLSearchParams(body.toString()).get('assertion') ?? '';
        const [h, c, sig] = assertion.split('.');
        const valid = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig ?? '', 'base64url'));
        const claim = JSON.parse(Buffer.from(c ?? '', 'base64url').toString() || '{}');
        if (!valid || claim.scope !== 'https://www.googleapis.com/auth/androidpublisher') return json(401, { error: 'invalid_grant' });
        return json(200, { access_token: 'mock-token-SECRET', expires_in: 1800 });
      }
      if (req.headers.authorization !== 'Bearer mock-token-SECRET') return json(401, { error: { message: 'no auth' } });
      if (req.method === 'POST' && req.url.endsWith('/applications/dev.hatly.customer/edits')) return json(200, { id: 'edit-1' });
      if (req.method === 'POST' && req.url.includes('/upload/') && req.url.includes('/edits/edit-1/bundles')) return json(200, { versionCode: 1, sha256: reportSha ?? createHash('sha256').update(body).digest('hex') });
      if (req.method === 'PUT' && req.url.endsWith('/edits/edit-1/tracks/internal')) return json(200, JSON.parse(body.toString()));
      if (req.method === 'POST' && req.url.endsWith('/edits/edit-1:commit')) return json(200, { id: 'edit-1' });
      return json(404, { error: { message: `unexpected ${req.method} ${req.url}` } });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, base: `http://127.0.0.1:${server.address().port}` })));
}
function run(argv, base) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...argv], { env: { PATH: process.env.PATH, HOME: dir, ...(base ? { HATLY_PLAY_API_BASE: base, HATLY_PLAY_TOKEN_URL: `${base}/token` } : {}) } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

test('uploads to the internal track as a DRAFT: signed JWT, edit, bundle, track, commit — key and token never printed', async () => {
  const m = await mock();
  try {
    const r = await run(['--aab', aab, '--key', keyFile, '--notes-dir', notesDir], m.base);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(m.calls.map((c) => `${c.method} ${c.url.replace(/\?.*/, '')}`), [
      'POST /token',
      'POST /androidpublisher/v3/applications/dev.hatly.customer/edits',
      'POST /upload/androidpublisher/v3/applications/dev.hatly.customer/edits/edit-1/bundles',
      'PUT /androidpublisher/v3/applications/dev.hatly.customer/edits/edit-1/tracks/internal',
      'POST /androidpublisher/v3/applications/dev.hatly.customer/edits/edit-1:commit',
    ]);
    const track = JSON.parse(m.calls[3].body.toString());
    assert.deepEqual(track.releases[0].versionCodes, ['1']);
    assert.equal(track.releases[0].status, 'draft');
    assert.deepEqual(track.releases[0].releaseNotes.map((n) => n.language).sort(), ['ar', 'en-US']);
    assert.match(r.out, new RegExp(aabSha));
    assert.match(r.out, /Uploaded is NOT reviewed, approved or public/);
    for (const secret of ['mock-token-SECRET', 'PRIVATE KEY']) assert.ok(!r.out.includes(secret) && !r.err.includes(secret), `${secret} printed`);
  } finally { m.server.close(); }
});

test('refuses to commit when Play reports a different bundle hash', async () => {
  const m = await mock({ reportSha: 'f'.repeat(64) });
  try {
    const r = await run(['--aab', aab, '--key', keyFile], m.base);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /not committing/);
    assert.ok(!m.calls.some((c) => c.url.endsWith(':commit')));
  } finally { m.server.close(); }
});

test('dry run validates and sends nothing', async () => {
  const m = await mock();
  try {
    const r = await run(['--aab', aab, '--key', keyFile, '--dry-run'], m.base);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /DRY RUN/);
    assert.equal(m.calls.length, 0);
  } finally { m.server.close(); }
});

for (const [name, argv, pattern] of [
  ['another package (the driver app)', ['--aab', aab, '--key', keyFile, '--package', 'com.hatly.driver'], /dev\.hatly\.customer only/],
  ['the production track', ['--aab', aab, '--key', keyFile, '--track', 'production'], /production is rolled out in Play Console/],
  ['a missing bundle', ['--aab', join(dir, 'nope.aab'), '--key', keyFile], /--aab/],
  ['a key readable by others', ['--aab', aab, '--key', keyFile], /chmod 600/],
]) {
  test(`refuses ${name}`, async () => {
    if (name.startsWith('a key readable')) chmodSync(keyFile, 0o644);
    try {
      const r = await run(argv, 'http://127.0.0.1:9');
      assert.notEqual(r.code, 0);
      assert.match(r.err, pattern);
    } finally { chmodSync(keyFile, 0o600); }
  });
}

test.after(() => rmSync(dir, { recursive: true, force: true }));
