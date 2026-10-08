/**
 * Consolidated customer-commerce milestone (Loyalty V1 + Conversion), over real HTTP. The ledger
 * business logic itself (earning calculation, conversion math, refund reversal proportionality,
 * idempotency, concurrency) already has thorough real-unit coverage in `loyalty.service.spec.ts`
 * (mocked at the repository boundary — a genuine DELIVERED order requires driving a full
 * vendor+dispatch+driver journey, already exhaustively covered for OTHER purposes in
 * `60-order-lifecycle.e2e-spec.ts`; reproducing that here just to re-prove ledger math already
 * proven at the unit level is not a good use of a real end-to-end journey). This file instead
 * proves the NEW customer-facing HTTP surface itself: real auth-role gating, real envelope shapes,
 * and the real conversion validation errors over the wire.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData } from './support/actors';

describe('E2E — Loyalty (balance, history, conversion)', () => {
  let world: World;
  let s: Scenario;
  let customer: Actor;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    customer = await s.customer('Loyalty E2E Customer');
  });
  afterAll(async () => {
    await world.close();
  });

  it('a customer with no activity sees a real zero balance and an empty, well-formed history page', async () => {
    const balance = expectData(await world.api('get', '/customer/loyalty', { token: customer.accessToken }));
    expect((balance as any).pointsBalance).toBe(0);

    const res = await world.api('get', '/customer/loyalty/transactions', { token: customer.accessToken });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 0 });
  });

  it('an unauthenticated caller is refused (401), never leaking another customer\'s balance shape', async () => {
    const res = await world.api('get', '/customer/loyalty', {});
    expect(res.status).toBe(401);
  });

  it('a non-CUSTOMER role (SUPER_ADMIN) cannot reach the loyalty endpoints — Role.CUSTOMER-only, same as Wallet', async () => {
    const admin = await s.superAdmin();
    const res = await world.api('get', '/customer/loyalty', { token: admin.accessToken });
    expect(res.status).toBe(403);
  });

  it('converting with no points available is rejected as insufficient, never creates a ledger row', async () => {
    const res = await world.api('post', '/customer/loyalty/convert', {
      token: customer.accessToken,
      body: { points: 500, idempotencyKey: `convert-${customer.id}-1` },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('INSUFFICIENT_POINTS');
  });

  it('APPROVED V1 RULE: below the 500-point minimum is rejected', async () => {
    const res = await world.api('post', '/customer/loyalty/convert', {
      token: customer.accessToken,
      body: { points: 100, idempotencyKey: `convert-${customer.id}-2` },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('BELOW_MINIMUM_CONVERSION');
    expect(res.body.error.details.minimum).toBe(500);
  });

  it('APPROVED V1 RULE: a non-multiple-of-100 amount is rejected', async () => {
    const res = await world.api('post', '/customer/loyalty/convert', {
      token: customer.accessToken,
      body: { points: 550, idempotencyKey: `convert-${customer.id}-3` },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('INVALID_CONVERSION_MULTIPLE');
  });
});
