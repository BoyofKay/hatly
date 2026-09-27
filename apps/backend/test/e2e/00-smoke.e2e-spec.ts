import { bootWorld, World } from './support/world';

describe('E2E harness smoke', () => {
  let world: World;
  beforeAll(async () => { world = await bootWorld(); });
  afterAll(async () => {
    await world.close();
  });

  it('serves the real application over a real socket with the real request-context middleware', async () => {
    const res = await world.api('get', '/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-correlation-id']).toMatch(/[0-9a-f-]{8,}/);
  });
});
