import { isWithinOpeningHours, cairoClock } from './branch-availability';

// Cairo is UTC+2 (no DST in winter 2026-11); 2026-11-09 is a Monday.
const at = (utc: string) => new Date(utc);

describe('isWithinOpeningHours (R9)', () => {
  it('no hours configured = no hour limit', () => {
    expect(isWithinOpeningHours({}, at('2026-11-09T01:00:00Z'))).toBe(true);
    expect(isWithinOpeningHours(null, at('2026-11-09T01:00:00Z'))).toBe(true);
  });

  it('inside / outside a same-day span, in Cairo time', () => {
    const h = { mon: { open: '09:00', close: '22:00' } };
    expect(cairoClock(at('2026-11-09T08:00:00Z'))).toMatchObject({ day: 'mon', time: '10:00' });
    expect(isWithinOpeningHours(h, at('2026-11-09T08:00:00Z'))).toBe(true); // 10:00 Cairo
    expect(isWithinOpeningHours(h, at('2026-11-09T06:30:00Z'))).toBe(false); // 08:30
    expect(isWithinOpeningHours(h, at('2026-11-09T20:00:00Z'))).toBe(false); // 22:00 = closing time
  });

  it('a day that is not listed is closed once any day is configured', () => {
    expect(isWithinOpeningHours({ tue: { open: '09:00', close: '22:00' } }, at('2026-11-09T10:00:00Z'))).toBe(false);
  });

  it('a span past midnight belongs to the day it starts; open = close means all day', () => {
    const night = { mon: { open: '18:00', close: '02:00' } };
    expect(isWithinOpeningHours(night, at('2026-11-09T17:00:00Z'))).toBe(true); // Mon 19:00
    expect(isWithinOpeningHours(night, at('2026-11-09T23:30:00Z'))).toBe(true); // Tue 01:30, from Monday's span
    expect(isWithinOpeningHours(night, at('2026-11-10T01:00:00Z'))).toBe(false); // Tue 03:00
    expect(isWithinOpeningHours({ mon: { open: '00:00', close: '00:00' } }, at('2026-11-09T12:00:00Z'))).toBe(true);
  });
});
