import { resolveMapProvider } from './location.module';

describe('resolveMapProvider (MAPS_PROVIDER selection)', () => {
  const google = { name: 'google' } as any;
  const deterministic = { name: 'deterministic' } as any;

  it('defaults to Google when MAPS_PROVIDER is unset', () => {
    expect(resolveMapProvider(undefined, 'development', google, deterministic)).toBe(google);
  });

  it('selects Google when MAPS_PROVIDER=google, in any environment', () => {
    expect(resolveMapProvider('google', 'production', google, deterministic)).toBe(google);
    expect(resolveMapProvider('google', 'development', google, deterministic)).toBe(google);
  });

  it('selects the deterministic provider in development/test', () => {
    expect(resolveMapProvider('deterministic', 'development', google, deterministic)).toBe(deterministic);
    expect(resolveMapProvider('deterministic', 'test', google, deterministic)).toBe(deterministic);
  });

  it('FAILS CLOSED: refuses the deterministic provider outright when NODE_ENV=production', () => {
    expect(() => resolveMapProvider('deterministic', 'production', google, deterministic)).toThrow(
      /must never be used when NODE_ENV=production/,
    );
  });

  it('refuses an unrecognized MAPS_PROVIDER value rather than silently defaulting', () => {
    expect(() => resolveMapProvider('bing', 'development', google, deterministic)).toThrow(/Unknown MAPS_PROVIDER/);
  });
});

describe('resolveMapProvider — MAPS_PROVIDER=none (PD-009 G)', () => {
  const google = { name: 'google' } as any;
  const deterministic = { name: 'deterministic' } as any;
  const unavailable = { name: 'unavailable', available: false } as any;

  it('selects the unavailable provider in production (and any other environment)', () => {
    expect(resolveMapProvider('none', 'production', google, deterministic, unavailable)).toBe(unavailable);
    expect(resolveMapProvider('none', 'development', google, deterministic, unavailable)).toBe(unavailable);
  });

  it('refuses to start rather than fall back when the unavailable provider is not wired', () => {
    expect(() => resolveMapProvider('none', 'production', google, deterministic)).toThrow(/UnavailableMapProvider/);
  });
});
