import { base32Decode, base32Encode, hotp, matchTotp, otpauthUrl, timeStep } from './totp';

// RFC 4226 appendix D: secret "12345678901234567890", counters 0..9.
const RFC4226 = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
const secret = Buffer.from('12345678901234567890');

describe('HOTP / TOTP (RFC 4226 / 6238 vectors)', () => {
  it('RFC 4226 test vectors', () => {
    RFC4226.forEach((expected, counter) => expect(hotp(secret, counter)).toBe(expected));
  });

  it('RFC 6238 vector: T = 59 s → 287082 (the 6-digit tail of 94287082)', () => {
    expect(hotp(secret, timeStep(59_000))).toBe('287082');
    expect(matchTotp(secret, '287082', 59_000)).toBe(1);
  });

  it('accepts ±1 step of drift and nothing further', () => {
    const now = 1_700_000_000_000;
    const step = timeStep(now);
    expect(matchTotp(secret, hotp(secret, step - 1), now)).toBe(step - 1);
    expect(matchTotp(secret, hotp(secret, step + 1), now)).toBe(step + 1);
    expect(matchTotp(secret, hotp(secret, step - 2), now)).toBeNull();
    expect(matchTotp(secret, hotp(secret, step + 2), now)).toBeNull();
  });

  it('refuses anything that is not exactly six digits', () => {
    const now = 1_700_000_000_000;
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456', '１２３４５６']) expect(matchTotp(secret, bad, now)).toBeNull();
  });

  it('base32 round-trips and rejects junk', () => {
    const bytes = Buffer.from('hello hatly secret!');
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(base32Encode(Buffer.from('12345678901234567890'))).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(() => base32Decode('not*base32')).toThrow();
  });

  it('otpauth URL carries the secret, issuer and parameters authenticator apps expect', () => {
    const url = otpauthUrl({ secretBase32: 'ABC234', accountName: '+201000000000', issuer: 'Hatly Admin' });
    expect(url).toBe('otpauth://totp/Hatly%20Admin%3A%2B201000000000?secret=ABC234&issuer=Hatly%20Admin&algorithm=SHA1&digits=6&period=30');
  });
});
