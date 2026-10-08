import { AuthController } from './auth.controller';
import { UploadsController } from '../uploads/uploads.controller';

/**
 * The brute-force protections that already existed on the login/registration/OTP routes are preserved, and M5 Batch 1 adds
 * explicit tighter limits on the two remaining sensitive writes (token refresh, image upload). Read from the real decorator
 * metadata so a refactor that drops a @Throttle fails here.
 */
const limitOf = (target: object, key: string): number | undefined => Reflect.getMetadata('THROTTLER:LIMITdefault', (target as any)[key]);

describe('route rate limits', () => {
  it('every credential/OTP/password route is throttled at or below 10 requests per minute', () => {
    const credentialRoutes = Object.getOwnPropertyNames(AuthController.prototype).filter((name) => {
      const handler = (AuthController.prototype as any)[name];
      const path = Reflect.getMetadata('path', handler);
      return typeof path === 'string' && /login|register|otp\/verify|password\/login/.test(path);
    });
    expect(credentialRoutes.length).toBeGreaterThanOrEqual(5);
    for (const name of credentialRoutes) {
      const limit = limitOf(AuthController.prototype, name);
      expect(limit).toBeDefined();
      expect(limit!).toBeLessThanOrEqual(10);
    }
  });

  it('token refresh is explicitly limited (20/min), well below the global 100/min', () => {
    expect(limitOf(AuthController.prototype, 'refresh')).toBe(20);
  });

  it('image upload is explicitly limited (30/min)', () => {
    expect(limitOf(UploadsController.prototype, 'create')).toBe(30);
  });
});
