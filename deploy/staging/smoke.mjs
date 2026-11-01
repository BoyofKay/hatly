#!/usr/bin/env node
// Post-deployment smoke test for Sales Staging (or a local rehearsal). Needs Node >= 20. Prints no secrets.
//   node smoke.mjs --api https://api-sales.hatly.dev/api/v1 --dashboard https://sales.hatly.dev
//   (local rehearsal over plain http:  add  --allow-http --origin https://sales.hatly.dev)
// By default it CREATES one throw-away test customer in the target environment (random phone, random password). Never point it at production.
// `--read-only` skips every step that writes (the registration/login block): what remains is GET/OPTIONS plus unauthenticated requests that the
// auth guard refuses (401) before any handler runs — safe against an environment whose data must not change.
import { randomBytes } from 'node:crypto';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const api = (arg('api') ?? '').replace(/\/$/, '');
const dashboard = (arg('dashboard') ?? '').replace(/\/$/, '');
const allowHttp = process.argv.includes('--allow-http');
const readOnly = process.argv.includes('--read-only');
if (!api) { console.error('usage: node smoke.mjs --api <https://host/api/v1> [--dashboard <https://host>] [--allow-http] [--read-only]'); process.exit(2); }
if (/^https:\/\/(api\.|www\.|admin\.)?hatly\.dev(\/|$)/.test(api)) { console.error('REFUSING: that looks like production.'); process.exit(2); }

let failed = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!cond) failed++; };
const j = async (r) => { try { return await r.json(); } catch { return null; } };
const call = (path, { method = 'GET', body, token, origin } = {}) =>
  fetch(api + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });

const origin = arg('origin') ?? (dashboard || new URL(api).origin); // the browser origin the API must allow (CORS_ALLOWED_ORIGINS)
const phone = '+2010' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const password = randomBytes(9).toString('base64url') + 'aA1';

// --- transport ---
ok('API URL is HTTPS', api.startsWith('https://') || allowHttp, api.split('/').slice(0, 3).join('/'));
ok('no localhost / LAN / quick-tunnel host in the API URL', allowHttp || !/localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.\d+\.\d+|trycloudflare/.test(api));

// --- health ---
let r = await call('/health'); ok('GET /health = 200', r.status === 200, String(r.status));
r = await call('/health/ready'); const ready = await j(r); ok('GET /health/ready = 200 (database + redis up)', r.status === 200, JSON.stringify(ready?.data?.checks ?? ready?.error?.details ?? ''));

// --- CORS ---
r = await call('/auth/customer/password/login', { method: 'OPTIONS', origin });
ok('CORS: the dashboard origin is allowed', r.headers.get('access-control-allow-origin') === origin, `allow-origin=${r.headers.get('access-control-allow-origin')}`);
r = await call('/auth/customer/password/login', { method: 'OPTIONS', origin: 'https://evil.example' });
ok('CORS: another origin is NOT allowed', r.headers.get('access-control-allow-origin') !== 'https://evil.example');

// --- guest browsing: public reads work, account-only endpoints are protected ---
r = await call('/sectors'); ok('guest GET /sectors = 200', r.status === 200, String(r.status));
r = await call('/search?q=a'); ok('guest GET /search = 200', r.status === 200, String(r.status));
for (const [m, p] of [['GET', '/cart'], ['GET', '/favorites'], ['GET', '/addresses'], ['GET', '/orders'], ['POST', '/orders'], ['POST', '/cart/items']]) {
  r = await call(p, { method: m, body: m === 'POST' ? {} : undefined }); ok(`guest ${m} ${p} = 401`, r.status === 401, String(r.status));
}

if (readOnly) {
  console.log('SKIP  registration / login / retired-route steps (--read-only: nothing is written)');
} else {
  // --- registration with OTP OFF ---
  r = await call('/auth/customer/register/request-code', { method: 'POST', body: { phone } });
  const rc = await j(r);
  ok('OTP is OFF in this environment (request-code answers CUSTOMER_OTP_DISABLED)', r.status === 400 && rc?.error?.details?.code === 'CUSTOMER_OTP_DISABLED', `${r.status} ${rc?.error?.details?.code ?? ''}`);
  r = await call('/auth/customer/password/register', { method: 'POST', body: { phone, fullName: 'Sales Smoke', password } });
  const reg = await j(r); ok('register with phone + password (no code) = 200 + session', r.status === 200 && !!reg?.data?.accessToken, String(r.status));
  r = await call('/auth/customer/password/register', { method: 'POST', body: { phone, fullName: 'Sales Smoke', password: 'Another-Pass-1' } });
  ok('registering the same phone again is refused (401, no overwrite)', r.status === 401, String(r.status));
  r = await call('/auth/customer/password/login', { method: 'POST', body: { phone, password: 'wrong-' + password } }); ok('wrong password = 401', r.status === 401, String(r.status));
  r = await call('/auth/customer/password/login', { method: 'POST', body: { phone, password } }); const login = await j(r);
  ok('phone + password login = 200', r.status === 200 && !!login?.data?.accessToken, String(r.status));
  const token = login?.data?.accessToken;
  r = await call('/auth/customer/me', { token }); const me = await j(r); ok('GET /auth/customer/me: phone is UNVERIFIED', r.status === 200 && me?.data?.isPhoneVerified === false, JSON.stringify(me?.data ?? ''));
  r = await call('/cart', { token }); ok('signed-in GET /cart = 200', r.status === 200, String(r.status));
  r = await call('/auth/register', { method: 'POST', body: { phone: '+201000000000', fullName: 'Old App' } });
  ok('retired OTP registration route creates nothing (400/410)', r.status === 400 || r.status === 410, String(r.status));
}

// --- dashboard ---
if (dashboard) {
  r = await fetch(dashboard, { redirect: 'manual' });
  ok('dashboard answers over HTTPS', (r.status === 200 || (r.status >= 300 && r.status < 400)) && (dashboard.startsWith('https://') || allowHttp), String(r.status));
  const html = await (await fetch(dashboard + '/login')).text();
  const chunks = [...html.matchAll(/\/_next\/static\/[^"']+\.js/g)].map((m) => m[0]).slice(0, 40);
  let bundle = html;
  for (const c of chunks) bundle += await (await fetch(dashboard + c)).text();
  ok('dashboard bundle is built against the staging API URL', bundle.includes(api), api);
  ok('dashboard bundle embeds no localhost / quick-tunnel API URL', !/localhost:3000\/api|trycloudflare/.test(bundle));
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll smoke checks passed');
process.exit(failed ? 1 : 0);
