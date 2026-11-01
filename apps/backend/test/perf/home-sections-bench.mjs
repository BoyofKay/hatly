// Reproducible comparison of the Customer Home product loading: the LEGACY request pattern (sectors -> 3 vendor lists -> 3 sections x 6
// vendors = 18 product lists) against the new single aggregation request. Public GETs only; nothing is written.
//
//   node test/perf/home-sections-bench.mjs --base http://localhost:3000 [--runs 5] [--redis-cli "redis-cli -n 0"]
//
// --base       the API host (no /api/v1). Point it at a latency-emulating proxy to model a real network.
// --redis-cli  optional: used to empty the home cache (`home:sections:*`) so "cold" really is cold.
import { execSync } from 'node:child_process';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith('--') ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
const BASE = (args.base ?? 'http://localhost:3000') + '/api/v1';
const RUNS = Number(args.runs ?? 5);
const REDIS = args['redis-cli'] ?? 'redis-cli';

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const now = () => performance.now();
let requests = 0;
let bytes = 0;
let failed = 0; // non-200 answers (e.g. 429 from the rate limiter when the legacy fan-out is repeated by many clients)
async function get(path, tally = true) {
  const started = now();
  const res = await fetch(BASE + path);
  const text = await res.text();
  if (res.status !== 200) failed++;
  if (tally) {
    requests++;
    bytes += text.length;
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON (e.g. a rate-limit page) */
  }
  return { status: res.status, json, ms: now() - started, cache: res.headers.get('x-home-cache') };
}
const flush = () => {
  try {
    execSync(`${REDIS} --scan --pattern 'home:sections:*' | xargs -I{} ${REDIS} del {} > /dev/null`, { stdio: 'ignore', shell: '/bin/bash' });
  } catch {
    /* no redis-cli: cold numbers then depend on TTL */
  }
};
/** The pattern the app used (home_providers.dart): sectors, then 3 vendor lists, then 18 product lists. */
async function legacy() {
  requests = 0;
  bytes = 0;
  const t0 = now();
  const marks = {};
  const sectors = ((await get('/sectors')).json?.data ?? []).sort((a, b) => a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : 1)).slice(0, 3);
  const lists = await Promise.all(sectors.map(async (s) => (await get(`/vendors?sectorId=${s.id}`)).json?.data ?? []));
  const seen = new Set();
  const ranked = lists.flat().filter((v) => seen.add(v.id)).sort((a, b) => b.ratingCount - a.ratingCount || b.ratingAverage - a.ratingAverage || (a.name < b.name ? -1 : 1)).slice(0, 6);
  const section = (qs, key) =>
    Promise.all(ranked.map((v) => get(`/vendor-branches/${v.id}/products?${qs}&availableOnly=true&limit=3`))).then(() => (marks[key] = now() - t0));
  await Promise.all([section('sort=bestSelling', 'mostOrdered'), section('sort=newest', 'newest'), section('hasOffers=true', 'offers')]);
  return { totalMs: now() - t0, firstSectionMs: Math.min(...Object.values(marks)), requests, bytes };
}

async function aggregation(qs = '') {
  requests = 0;
  bytes = 0;
  const t0 = now();
  const r = await get(`/home/product-sections${qs}`);
  return { totalMs: now() - t0, firstSectionMs: now() - t0, requests, bytes, cache: r.cache, backendMs: r.ms };
}

const row = (label, runs, extra = '') =>
  console.log(
    `${label.padEnd(34)} requests ${String(runs[0].requests).padStart(2)} | first section ${median(runs.map((r) => r.firstSectionMs)).toFixed(0).padStart(5)} ms | all three ${median(runs.map((r) => r.totalMs)).toFixed(0).padStart(5)} ms | payload ${String(runs[0].bytes).padStart(7)} B ${extra}`,
  );

async function repeat(fn, prep) {
  const out = [];
  for (let i = 0; i < RUNS; i++) {
    if (prep) prep();
    out.push(await fn());
  }
  return out;
}

console.log(`API ${BASE}   runs per case: ${RUNS} (medians)\n`);
await get('/sectors', false); // warm-up
const legacyRuns = await repeat(legacy, flush);
row('LEGACY (sectors+vendors+18 lists)', legacyRuns);

const cold = await repeat(() => aggregation(), flush);
row('AGGREGATION cold cache', cold, `| X-Home-Cache ${cold[0].cache} | server ${median(cold.map((r) => r.backendMs)).toFixed(0)} ms`);
const warm = await repeat(() => aggregation());
row('AGGREGATION warm cache', warm, `| X-Home-Cache ${warm[0].cache} | server ${median(warm.map((r) => r.backendMs)).toFixed(0)} ms`);

// concurrency: 40 simultaneous Home loads, cold then warm
for (const [label, prep] of [['40 concurrent, cold cache', flush], ['40 concurrent, warm cache', null]]) {
  if (prep) prep();
  const t0 = now();
  const rs = await Promise.all(Array.from({ length: 40 }, () => get('/home/product-sections', false)));
  const ms = rs.map((r) => r.ms);
  console.log(`${label.padEnd(34)} wall ${(now() - t0).toFixed(0).padStart(5)} ms | per-request median ${median(ms).toFixed(0)} ms, max ${Math.max(...ms).toFixed(0)} ms | cache ${[...new Set(rs.map((r) => r.cache))].join('/')}`);
}
{
  flush();
  const t0 = now();
  failed = 0;
  await Promise.all(Array.from({ length: 40 }, () => legacy()));
  console.log(`${'40 concurrent LEGACY (22 req each)'.padEnd(34)} wall ${(now() - t0).toFixed(0).padStart(5)} ms | non-200 answers: ${failed} of ${40 * 22}`);
}
