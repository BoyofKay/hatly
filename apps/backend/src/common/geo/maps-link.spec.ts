import { isAllowedMapsUrl, parseLatLng, resolveMapsLink } from './maps-link';

describe('maps links', () => {
  it('reads Google / Apple links and plain coordinates', () => {
    expect(parseLatLng('https://www.google.com/maps/place/X/@30.4170,31.5620,17z')).toEqual({ lat: 30.417, lng: 31.562 });
    expect(parseLatLng('https://www.google.com/maps/place/X/data=!3d30.41!4d31.56')).toEqual({ lat: 30.41, lng: 31.56 });
    expect(parseLatLng('https://maps.google.com/?q=30.4170,31.5620')).toEqual({ lat: 30.417, lng: 31.562 });
    expect(parseLatLng('https://maps.apple.com/?ll=30.4,31.5&q=Shop')).toEqual({ lat: 30.4, lng: 31.5 });
    expect(parseLatLng('30.417, 31.562')).toEqual({ lat: 30.417, lng: 31.562 });
    expect(parseLatLng('hello')).toBeNull();
    expect(parseLatLng('91, 31')).toBeNull();
  });

  it('opens only Google / Apple map hosts', () => {
    expect(isAllowedMapsUrl('https://maps.app.goo.gl/abc123')).toBe(true);
    expect(isAllowedMapsUrl('https://evil.example.com/maps')).toBe(false);
    expect(isAllowedMapsUrl('http://maps.app.goo.gl/abc')).toBe(false);
  });

  it('follows a short link to the final address; never leaves the map hosts', async () => {
    const hops: Record<string, string> = {
      'https://maps.app.goo.gl/abc': 'https://www.google.com/maps?q=xyz',
      'https://www.google.com/maps?q=xyz': 'https://www.google.com/maps/place/Shop/@30.42,31.57,17z',
    };
    const fake = (async (url: string) => ({ headers: { get: () => hops[url] ?? null } })) as unknown as typeof fetch;
    await expect(resolveMapsLink('https://maps.app.goo.gl/abc', fake)).resolves.toEqual({ lat: 30.42, lng: 31.57 });
    const evil = (async () => ({ headers: { get: () => 'https://evil.example.com/x' } })) as unknown as typeof fetch;
    await expect(resolveMapsLink('https://maps.app.goo.gl/abc', evil)).resolves.toBeNull();
    await expect(resolveMapsLink('https://evil.example.com/abc', fake)).resolves.toBeNull();
  });
});

describe('resolveMapsLink — UAT ML-01 real-world links', () => {
  const reply = (status: number, headers: Record<string, string> = {}, body = '') =>
    new Response(body, { status, headers });

  it('goes through the EU consent page to the real link', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://maps.app.goo.gl/')) return reply(302, { location: 'https://consent.google.com/m?continue=' + encodeURIComponent('https://www.google.com/maps/place/X/@30.4171,31.5622,17z') });
      throw new Error('unexpected ' + url);
    }) as unknown as typeof fetch;
    await expect(resolveMapsLink('https://maps.app.goo.gl/abc', fetchImpl)).resolves.toEqual({ lat: 30.4171, lng: 31.5622 });
    expect(calls).toHaveLength(1);
  });

  it('reads a place page whose address carries only the place name', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.startsWith('https://maps.app.goo.gl/')) return reply(302, { location: 'https://www.google.com/maps?q=Some+Pharmacy&ftid=0x1:0x2' });
      return reply(200, { 'content-type': 'text/html' }, '<meta content="https://maps.google.com/maps/api/staticmap?center=30.4213%2C31.5634&amp;zoom=15" itemprop="image">');
    }) as unknown as typeof fetch;
    await expect(resolveMapsLink('https://maps.app.goo.gl/xyz', fetchImpl)).resolves.toEqual({ lat: 30.4213, lng: 31.5634 });
  });

  it('never follows a consent page that points away from the map hosts', async () => {
    const fetchImpl = (async () => reply(302, { location: 'https://consent.google.com/m?continue=' + encodeURIComponent('https://evil.example/') })) as unknown as typeof fetch;
    await expect(resolveMapsLink('https://maps.app.goo.gl/abc', fetchImpl)).resolves.toBeNull();
  });
});
