import { CheckoutQuoteTokenService, QuoteTokenPayload } from './checkout-quote-token.service';

const service = (secret = 'secret-A') => new CheckoutQuoteTokenService({ get: () => secret } as any);
const payload = (over: Partial<QuoteTokenPayload> = {}): QuoteTokenPayload => ({
  v: 1,
  cid: 'cust-1',
  exp: 2_000_000_000,
  ih: 'hash',
  breakdown: null,
  amounts: { subtotalMinor: 1000, discountMinor: 0, deliveryFeeMinor: 500, totalMinor: 1500, walletAppliedMinor: 0, amountDueMinor: 1500 },
  ...over,
});

describe('CheckoutQuoteTokenService', () => {
  it('a signed token verifies for its own customer while unexpired, and returns the frozen payload', () => {
    const token = service().sign(payload());
    const result = service().verify(token, 'cust-1', 1_000_000_000);
    expect(result).toEqual({ status: 'VALID', payload: payload() });
  });

  it('is EXPIRED (still readable, so the current quote can be offered) once its time has passed', () => {
    const token = service().sign(payload({ exp: 100 }));
    expect(service().verify(token, 'cust-1', 200)).toMatchObject({ status: 'EXPIRED' });
    expect(service().verify(token, 'cust-1', 100)).toMatchObject({ status: 'EXPIRED' }); // the expiry instant itself is already too late
  });

  it("is INVALID for anyone else's customer id", () => {
    expect(service().verify(service().sign(payload()), 'cust-2', 1)).toEqual({ status: 'INVALID' });
  });

  it('is INVALID when the payload is altered (a cheaper fee, a later expiry) — the signature no longer matches', () => {
    const token = service().sign(payload());
    const [body, sig] = token.split('.');
    const tampered = JSON.parse(Buffer.from(body, 'base64url').toString());
    tampered.amounts.deliveryFeeMinor = 1;
    tampered.exp = 9_999_999_999;
    const forged = `${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${sig}`;
    expect(service().verify(forged, 'cust-1', 1)).toEqual({ status: 'INVALID' });
  });

  it('is INVALID when signed with another secret (another deployment / a guessed key)', () => {
    expect(service('secret-B').verify(service('secret-A').sign(payload()), 'cust-1', 1)).toEqual({ status: 'INVALID' });
  });

  it.each([['empty', ''], ['no dot', 'abc'], ['three parts', 'a.b.c'], ['no signature', 'abc.'], ['garbage', '!!!.???']])('malformed token (%s) is INVALID, never a throw', (_l, token) => {
    expect(service().verify(token, 'cust-1', 1)).toEqual({ status: 'INVALID' });
  });

  it('a payload of an unknown version is INVALID even when correctly signed', () => {
    const token = service().sign({ ...payload(), v: 2 as never });
    expect(service().verify(token, 'cust-1', 1)).toEqual({ status: 'INVALID' });
  });
});
