import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as jwt from 'jsonwebtoken';
import { HatlyThrottlerGuard } from './hatly-throttler.guard';

const SECRET = 'q7Zr2KfX9mLp4TnB8vYc1WdH6sJg3EaU';

describe('HatlyThrottlerGuard client identity', () => {
  const guard = new HatlyThrottlerGuard(
    { throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }] } as any,
    { increment: jest.fn() } as any,
    { getAllAndOverride: jest.fn() } as any,
    new JwtService({}),
    { get: (k: string) => (k === 'auth.accessSecret' ? SECRET : undefined) } as unknown as ConfigService,
  );
  const tracker = (req: Record<string, any>) => (guard as any).getTracker(req) as Promise<string>;
  const token = (payload: object, opts: jwt.SignOptions = {}, secret = SECRET) => jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '15m', ...opts });

  it('an authenticated request (req.user set by JwtAuthGuard) is limited per USER, not per IP — two users behind one router get separate budgets', async () => {
    expect(await tracker({ user: { id: 'user-a' }, ip: '203.0.113.7' })).toBe('u:user-a');
    expect(await tracker({ user: { id: 'user-b' }, ip: '203.0.113.7' })).toBe('u:user-b');
  });

  it('a public route with a VALID bearer token is still limited per user', async () => {
    expect(await tracker({ headers: { authorization: `Bearer ${token({ sub: 'user-a', role: 'CUSTOMER' })}` }, ip: '203.0.113.7' })).toBe('u:user-a');
  });

  it.each([
    ['no credentials', {}],
    ['a malformed token', { authorization: 'Bearer not.a.jwt' }],
    ['a token signed with the wrong secret', { authorization: `Bearer ${token({ sub: 'victim' }, {}, 'a-different-secret-entirely-0000000')}` }],
    ['an expired token', { authorization: `Bearer ${token({ sub: 'victim' }, { expiresIn: -10 })}` }],
    ['an alg=none token', { authorization: `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"victim"}').toString('base64url')}.` }],
    ['a token with no subject', { authorization: `Bearer ${token({ role: 'CUSTOMER' })}` }],
    ['a non-bearer scheme', { authorization: `Basic ${token({ sub: 'victim' })}` }],
  ])('%s falls back to the IP, so it can never be used to dodge or to impersonate another bucket', async (_label, headers) => {
    expect(await tracker({ headers, ip: '198.51.100.9' })).toBe('ip:198.51.100.9');
  });

  it('with neither a user nor an address it still yields a stable key rather than throwing', async () => {
    expect(await tracker({})).toBe('ip:unknown');
  });
});
