/**
 * The Hatly / Wasally route as an order froze it (PD-012): origin → destination, each with its label, coordinates and whether it was the
 * customer's choice or the service default. Read from the delivery breakdown snapshot; null for every other order and for one placed before
 * PD-012 (its breakdown has no `route`). Never reconstructs or guesses a point.
 */
export interface FrozenRoutePoint {
  latitude: number;
  longitude: number;
  label: string | null;
  source: 'CUSTOMER' | 'DEFAULT';
}

export interface FrozenRoute {
  service: string | null;
  origin: FrozenRoutePoint;
  destination: FrozenRoutePoint;
}

function point(raw: unknown): FrozenRoutePoint | null {
  const p = raw as Partial<FrozenRoutePoint> | null;
  if (!p || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return null;
  return { latitude: p.latitude, longitude: p.longitude, label: typeof p.label === 'string' ? p.label : null, source: p.source === 'DEFAULT' ? 'DEFAULT' : 'CUSTOMER' };
}

export function readFrozenRoute(snapshot: unknown): FrozenRoute | null {
  const b = snapshot as { service?: unknown; route?: { origin?: unknown; destination?: unknown } } | null;
  const origin = point(b?.route?.origin);
  const destination = point(b?.route?.destination);
  if (!origin || !destination) return null;
  return { service: typeof b?.service === 'string' ? b.service : null, origin, destination };
}
