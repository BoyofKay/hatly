import { normalizeEgyptianPhoneForUnifonic } from './normalize-egyptian-phone-for-unifonic';

describe('normalizeEgyptianPhoneForUnifonic', () => {
  it('strips a leading + (E.164 format, the normal case for stored User.phone values)', () => {
    expect(normalizeEgyptianPhoneForUnifonic('+201012345678')).toBe('201012345678');
  });

  it('strips a leading 00 (international dialing prefix format)', () => {
    expect(normalizeEgyptianPhoneForUnifonic('00201012345678')).toBe('201012345678');
  });

  it('leaves an already-normalized bare 20... number untouched', () => {
    expect(normalizeEgyptianPhoneForUnifonic('201012345678')).toBe('201012345678');
  });
});
