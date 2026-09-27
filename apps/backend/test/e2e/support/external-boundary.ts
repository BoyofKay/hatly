/**
 * The ONLY test doubles in the E2E suite, all at the external network edge:
 *
 *  - Unifonic SMS (HTTPS) and Google Maps Distance Matrix (HTTPS): the REAL provider classes
 *    (UnifonicSmsProvider, GoogleMapsProvider with its real Redis cache) run with dummy
 *    credentials; their `fetch` is answered here deterministically. This is also how the suite
 *    obtains OTP codes with no real SMS: the code is read out of the intercepted message body.
 *  - Any OTHER outbound fetch is refused and recorded, so an accidental real call (paid API,
 *    payment gateway, ...) fails loudly and is asserted absent.
 *  - FCM push goes through the firebase-admin SDK (not fetch): the push provider token is
 *    overridden with a capturing double (see world.ts). No Firebase credentials exist at all.
 */
import { DUMMY_MAPS_KEY, DUMMY_UNIFONIC_APP_SID } from './config';

export interface CapturedSms { to: string; body: string; code: string | null }
export interface CapturedPush { tokens: string[]; title: string; body: string; data: Record<string, string> }

export const boundary = {
  sms: [] as CapturedSms[],
  push: [] as CapturedPush[],
  mapsCalls: 0,
  /** Outbound HTTP the app attempted to make to a host that is NOT one of the two faked providers. */
  forbiddenCalls: [] as string[],
  /** Set to true to make the fake Unifonic reject sends (provider-outage scenario). */
  smsOutage: false,
  /** Set to true to make the fake Google Maps answer HTTP 503 (provider-outage scenario). */
  mapsOutage: false,
  /**
   * How the FCM double behaves: 'ok' (default), 'fail' (provider answers success:false), 'throw'
   * (provider throws), or 'invalid' (provider reports every token as invalid/unregistered).
   */
  pushMode: 'ok' as 'ok' | 'fail' | 'throw' | 'invalid',
  reset(): void {
    this.sms.length = 0; this.push.length = 0; this.mapsCalls = 0; this.forbiddenCalls.length = 0; this.smsOutage = false; this.mapsOutage = false; this.pushMode = 'ok';
  },
  lastOtpFor(phone: string): string {
    const normalized = phone.replace(/^\+/, '');
    const hit = [...this.sms].reverse().find((m) => m.to === normalized || m.to === phone);
    if (!hit?.code) throw new Error(`No OTP SMS was captured for ${phone}`);
    return hit.code;
  },
};

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function installExternalBoundary(): void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);

    if (url.hostname === 'el.cloud.unifonic.com') {
      const params = new URLSearchParams(String(init?.body ?? ''));
      if (params.get('AppSid') !== DUMMY_UNIFONIC_APP_SID) return json({ success: false }, 401);
      if (boundary.smsOutage) return json({ success: false }, 503);
      const body = params.get('Body') ?? '';
      boundary.sms.push({ to: params.get('Recipient') ?? '', body, code: body.match(/(\d{6})/)?.[1] ?? null });
      return json({ success: true, data: { MessageID: `e2e-msg-${boundary.sms.length}` } });
    }

    if (url.hostname === 'maps.googleapis.com') {
      boundary.mapsCalls += 1;
      if (boundary.mapsOutage) return json({ status: 'UNKNOWN_ERROR' }, 503);
      if (url.searchParams.get('key') !== DUMMY_MAPS_KEY) return json({ status: 'REQUEST_DENIED' });
      if (url.pathname.endsWith('/geocode/json')) {
        // Geocoding API (address picker suggestions): reverse lookups answer a fixed label; forward lookups know one place.
        const latlng = url.searchParams.get('latlng');
        if (latlng) return json({ status: 'OK', results: [{ formatted_address: `E2E Street near ${latlng}` }] });
        const address = url.searchParams.get('address') ?? '';
        return address.toLowerCase().includes('nowhere')
          ? json({ status: 'ZERO_RESULTS', results: [] })
          : json({ status: 'OK', results: [{ geometry: { location: { lat: 30.425, lng: 31.565 } } }] });
      }
      const [oLat, oLng] = (url.searchParams.get('origins') ?? '').split(',').map(Number);
      const [dLat, dLng] = (url.searchParams.get('destinations') ?? '').split(',').map(Number);
      // Deterministic "driving" distance: straight line x1.3, rounded to whole metres; 30 km/h.
      const meters = Math.round(haversineMeters(oLat, oLng, dLat, dLng) * 1.3);
      return json({
        status: 'OK',
        rows: [{ elements: [{ status: 'OK', distance: { value: meters }, duration: { value: Math.round(meters / 8.33) } }] }],
      });
    }

    boundary.forbiddenCalls.push(`${init?.method ?? 'GET'} ${url.origin}${url.pathname}`);
    throw new Error(`E2E: outbound HTTP to ${url.origin} is not permitted (only the faked Unifonic/Maps hosts are reachable).`);
  }) as typeof fetch;
  void realFetch;
}
