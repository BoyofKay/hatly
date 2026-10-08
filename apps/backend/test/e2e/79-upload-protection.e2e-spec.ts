/**
 * M5 Batch 4 — resource protection around uploads, over real HTTP against the fully wired app: the concurrency cap on in-flight
 * uploads (memory): excess uploads queue rather than fail, an aborted upload frees its slot, an unauthenticated upload still gets
 * its normal 401, and the existing size/content limits still apply first.
 */
import * as http from 'http';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, PNG_1X1_BASE64 } from './support/actors';

describe('E2E — upload resource protection', () => {
  let world: World;
  let s: Scenario;
  let actors: Actor[];
  const saved = process.env.UPLOAD_MAX_CONCURRENT;

  beforeAll(async () => {
    process.env.UPLOAD_MAX_CONCURRENT = '2';
    world = await bootWorld();
    s = new Scenario(world);
    actors = await Promise.all(Array.from({ length: 14 }, (_, i) => s.customer(`Upload ${i}`)));
  });
  afterAll(async () => {
    try {
      await world?.close();
    } finally {
      saved === undefined ? delete process.env.UPLOAD_MAX_CONCURRENT : (process.env.UPLOAD_MAX_CONCURRENT = saved);
    }
  });

  const png = Buffer.from(PNG_1X1_BASE64, 'base64');
  const bigImage = () => Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]).toString('base64');
  const upload = (a: Actor, content: string) => world.api('post', '/uploads', { token: a.accessToken, body: { base64Content: content, filename: 'p.png' } });

  it('with many simultaneous large uploads beyond the cap, none fail: the excess simply queues and every upload is stored', async () => {
    const content = bigImage();
    const before = (await world.ds.query('SELECT count(*)::int AS n FROM uploads'))[0].n;
    const started = Date.now();
    const results = await Promise.all(actors.slice(0, 12).map((a) => upload(a, content)));
    expect(results.map((r) => r.status)).toEqual(Array(12).fill(201)); // slower, never refused (cap is 2)
    expect((await world.ds.query('SELECT count(*)::int AS n FROM uploads'))[0].n).toBe(before + 12);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('once the burst is over the slots are free again: a normal upload succeeds', async () => {
    expect((await upload(actors[13], PNG_1X1_BASE64)).status).toBe(201);
  });

  it('a client that disconnects mid-upload frees its slot (no leak): afterwards uploads still go through', async () => {
    const u = new URL(world.baseUrl);
    const body = JSON.stringify({ base64Content: bigImage(), filename: 'p.png' });
    await Promise.all(
      [0, 1, 2, 3].map(
        (i) =>
          new Promise<void>((resolve) => {
            const req = http.request({ host: u.hostname, port: u.port, method: 'POST', path: '/api/v1/uploads', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${actors[i].accessToken}` } });
            req.on('error', () => resolve());
            req.write(body.slice(0, 200_000)); // a partial body, then the connection is dropped
            setTimeout(() => { req.destroy(); resolve(); }, 150);
          }),
      ),
    );
    await new Promise((r) => setTimeout(r, 300));
    const after = await Promise.all(actors.slice(4, 6).map((a) => upload(a, PNG_1X1_BASE64)));
    expect(after.map((r) => r.status)).toEqual([201, 201]);
  });

  it('an unauthenticated or expired-token upload still receives a clean 401 (not a reset), even when the body is large and the cap is saturated', async () => {
    const content = bigImage();
    const busy = Promise.all(actors.slice(7, 11).map((a) => upload(a, content))); // saturate the cap of 2
    const anon = await world.api('post', '/uploads', { body: { base64Content: content, filename: 'p.png' } });
    const forged = await world.api('post', '/uploads', { token: 'forged.token.value', body: { base64Content: content, filename: 'p.png' } });
    expect([anon.status, forged.status]).toEqual([401, 401]);
    expect((await busy).every((r) => r.status === 201)).toBe(true);
  });

  it('the existing size and content rules still apply first: an over-limit body is a 413 and a non-image is a 400, neither leaves a slot held', async () => {
    const over = await upload(actors[6], Buffer.alloc(9 * 1024 * 1024, 65).toString('base64'));
    expect(over.status).toBe(413);
    expect((await upload(actors[6], Buffer.from('<html>not an image at all, padding padding</html>').toString('base64'))).status).toBe(400);
    expect((await upload(actors[6], PNG_1X1_BASE64)).status).toBe(201);
  });
});
