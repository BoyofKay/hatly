#!/usr/bin/env node
// Uploads the verified CUSTOMER app bundle to Google Play through the official Play Developer API (edits → bundle upload → track → commit).
// Customer app only: the package is fixed to dev.hatly.customer and anything else is refused (the driver app is out of scope).
//
//   node scripts/launch/play-upload.mjs --aab <path> [--track internal|alpha] [--status draft|completed] [--notes-dir <dir>] [--dry-run]
//   key: ~/.hatly/play-service-account.json (mode 600; override with --key). The key and the access token are NEVER printed.
//
// Defaults are the safest: --track internal (Internal testing) and --status draft (nothing reaches testers until a person rolls it out in
// Play Console — and a never-published app only accepts draft releases anyway). `alpha` = Closed testing. Production is deliberately not
// offered here: it is applied for and rolled out in Play Console after the closed test.
// Service account permission needed (Play Console > Users and permissions, app-level, dev.hatly.customer ONLY): "Release apps to testing
// tracks". No Google Cloud IAM role is needed; the "Google Play Android Developer API" must be enabled in its Cloud project.
// Test seam: HATLY_PLAY_API_BASE / HATLY_PLAY_TOKEN_URL point the script at a mock server (scripts/launch/test/play-upload.test.mjs).
import { createSign, createHash } from 'node:crypto';
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

const PACKAGE = 'dev.hatly.customer';
const TRACKS = new Set(['internal', 'alpha']);
const STATUSES = new Set(['draft', 'completed']);
const API = process.env.HATLY_PLAY_API_BASE ?? 'https://androidpublisher.googleapis.com';
const TOKEN_URL = process.env.HATLY_PLAY_TOKEN_URL ?? 'https://oauth2.googleapis.com/token';

const die = (msg) => { console.error(`STOP: ${msg}`); process.exit(1); };
const args = (() => {
  const a = { track: 'internal', status: 'draft', key: join(homedir(), '.hatly', 'play-service-account.json'), dryRun: false };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i];
    if (k === '--dry-run') a.dryRun = true;
    else if (['--aab', '--track', '--status', '--key', '--notes-dir', '--package'].includes(k)) a[k.slice(2).replace('-dir', 'Dir')] = v[++i];
    else die(`unknown argument ${k}`);
  }
  return a;
})();

if (args.package && args.package !== PACKAGE) die(`this uploader is for ${PACKAGE} only (got ${args.package}); the driver app is out of scope`);
if (!args.aab || !existsSync(args.aab)) die('--aab <path to the verified app-release.aab> is required');
if (!TRACKS.has(args.track)) die(`--track must be one of ${[...TRACKS].join(', ')} (production is rolled out in Play Console, not here)`);
if (!STATUSES.has(args.status)) die('--status must be draft or completed');
const aab = readFileSync(args.aab);
if (aab.subarray(0, 2).toString('latin1') !== 'PK') die('the file is not an Android App Bundle (zip)');
const sha256 = createHash('sha256').update(aab).digest('hex');

const notes = [];
if (args.notesDir) {
  for (const f of readdirSync(args.notesDir).filter((n) => /^[a-z]{2}(-[A-Z]{2})?\.txt$/.test(n))) {
    const text = readFileSync(join(args.notesDir, f), 'utf8').trim();
    if (text.length > 500) die(`${f}: release notes are ${text.length} characters (Play allows 500)`);
    notes.push({ language: basename(f, '.txt'), text });
  }
}

if (!existsSync(args.key)) die(`service-account key not found at ${args.key} (see the header of this script for how to create it)`);
if ((statSync(args.key).mode & 0o077) !== 0) die(`${args.key} must be readable by you only (chmod 600)`);
let key;
try { key = JSON.parse(readFileSync(args.key, 'utf8')); } catch { die(`${args.key} is not valid JSON`); }
if (key.type !== 'service_account' || !key.client_email || !String(key.private_key ?? '').includes('PRIVATE KEY')) die('the key file is not a Google service-account key');

console.log(`bundle: ${basename(args.aab)} (${aab.length} bytes, sha256 ${sha256})`);
console.log(`target: ${PACKAGE} · track ${args.track} · status ${args.status} · notes ${notes.map((n) => n.language).join(', ') || 'none'} · as ${key.client_email}`);
if (args.dryRun) { console.log('DRY RUN — inputs valid; nothing was sent.'); process.exit(0); }

const b64url = (b) => Buffer.from(b).toString('base64url');
async function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: TOKEN_URL, iat: now, exp: now + 1800 }));
  const signature = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(key.private_key).toString('base64url');
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${signature}` }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) die(`could not obtain an access token (HTTP ${r.status}${j.error ? `: ${j.error}` : ''})`);
  return j.access_token;
}
async function call(method, url, tok, body, contentType = 'application/json') {
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${tok}`, ...(body ? { 'content-type': contentType } : {}) },
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body });
  const text = await r.text();
  let j = {}; try { j = JSON.parse(text); } catch { /* keep text */ }
  if (!r.ok) die(`${method} ${url.replace(API, '')} -> HTTP ${r.status}: ${(j.error?.message ?? text).slice(0, 300)}`);
  return j;
}

const tok = await token();
const base = `${API}/androidpublisher/v3/applications/${PACKAGE}`;
const edit = await call('POST', `${base}/edits`, tok, {});
console.log(`edit ${edit.id} opened`);
const up = await call('POST', `${API}/upload/androidpublisher/v3/applications/${PACKAGE}/edits/${edit.id}/bundles?uploadType=media`, tok, aab, 'application/octet-stream');
if (up.sha256 && up.sha256 !== sha256) die(`Play reports sha256 ${up.sha256}, the local file is ${sha256} — not committing`);
console.log(`uploaded: versionCode ${up.versionCode} (sha256 verified by Play: ${up.sha256 === sha256 ? 'yes' : 'not reported'})`);
await call('PUT', `${base}/edits/${edit.id}/tracks/${args.track}`, tok, {
  track: args.track,
  releases: [{ versionCodes: [String(up.versionCode)], status: args.status, ...(notes.length ? { releaseNotes: notes } : {}) }],
});
const done = await call('POST', `${base}/edits/${edit.id}:commit`, tok);
console.log(`COMMITTED edit ${done.id ?? edit.id}: versionCode ${up.versionCode} on track "${args.track}" as ${args.status.toUpperCase()}.`);
console.log(args.status === 'draft'
  ? 'Next (a person, in Play Console): review the draft release and roll it out. Uploaded is NOT reviewed, approved or public.'
  : 'Rolled out to the track testers. This is not a production (public) release.');
console.log(`Record it: scripts/launch/build-android-release.sh record-upload customer ${args.track === 'alpha' ? 'closed-testing' : 'internal-testing'}`);
