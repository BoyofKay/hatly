/**
 * Decodes a JWT payload for DISPLAY purposes only (e.g. showing the
 * logged-in Admin's role to gate which nav items render). This is
 * never a security boundary — every backend endpoint independently
 * enforces its own authorization regardless of what this returns.
 */
export interface DashboardJwtPayload {
  sub: string;
  role: 'VENDOR' | 'VENDOR_MANAGER' | 'ADMIN' | 'SUPER_ADMIN';
  phone: string;
}

export function decodeJwtPayload(token: string): DashboardJwtPayload | null {
  try {
    const [, payloadSegment] = token.split('.');
    const json = atob(payloadSegment.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as DashboardJwtPayload;
  } catch {
    return null;
  }
}
