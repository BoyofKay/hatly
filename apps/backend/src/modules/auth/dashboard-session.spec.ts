import { clearCookie, csrfTokenFor, isCsrfTokenValid, isOriginAllowed, newSessionId, parseCookies, serializeCookie } from './dashboard-session';

describe('dashboard session helpers', () => {
  it('parses cookies, decodes values, and the FIRST duplicate wins (a planted later cookie cannot override)', () => {
    expect(parseCookies('a=1; hatly_at=abc%3D; b=2; hatly_at=evil')).toEqual({ a: '1', hatly_at: 'abc=', b: '2' });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('novalue; =x; ok=1')).toEqual({ ok: '1' });
  });

  it('the CSRF token is bound to the session id and the server secret', () => {
    const sid = newSessionId();
    const token = csrfTokenFor(sid, 'secret-a');
    expect(isCsrfTokenValid(token, sid, 'secret-a')).toBe(true);
    expect(isCsrfTokenValid(token, sid, 'secret-b')).toBe(false); // another server secret
    expect(isCsrfTokenValid(token, newSessionId(), 'secret-a')).toBe(false); // another session
    expect(isCsrfTokenValid(undefined, sid, 'secret-a')).toBe(false);
    expect(isCsrfTokenValid(token, undefined, 'secret-a')).toBe(false);
    expect(isCsrfTokenValid(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), sid, 'secret-a')).toBe(false);
    expect(isCsrfTokenValid('', sid, 'secret-a')).toBe(false);
  });

  it('session ids are unguessable and unique', () => {
    const ids = new Set(Array.from({ length: 200 }, newSessionId));
    expect(ids.size).toBe(200);
    expect([...ids][0].length).toBeGreaterThanOrEqual(32);
  });

  it('origin policy: exact match against the list; strict with an empty list refuses; absent Origin is left to the other checks', () => {
    expect(isOriginAllowed('https://admin.example', ['https://admin.example'], true)).toBe(true);
    expect(isOriginAllowed('https://evil.example', ['https://admin.example'], true)).toBe(false);
    expect(isOriginAllowed('https://admin.example.evil.com', ['https://admin.example'], true)).toBe(false);
    expect(isOriginAllowed('https://anything', [], false)).toBe(true);
    expect(isOriginAllowed('https://anything', [], true)).toBe(false);
    expect(isOriginAllowed(undefined, ['https://admin.example'], true)).toBe(true);
  });

  it('cookies are HttpOnly + SameSite=Strict, Secure only when asked, and clearing expires them', () => {
    const c = serializeCookie('hatly_at', 'v a', { secure: true, path: '/api/v1', maxAgeSeconds: 900 });
    expect(c).toBe('hatly_at=v%20a; Path=/api/v1; Max-Age=900; HttpOnly; SameSite=Strict; Secure');
    expect(serializeCookie('x', 'y', { secure: false, path: '/', maxAgeSeconds: 5 })).not.toContain('Secure');
    expect(clearCookie('hatly_at', { secure: true, path: '/api/v1' })).toContain('Max-Age=0');
  });
});
