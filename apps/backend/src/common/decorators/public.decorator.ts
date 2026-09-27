import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks an endpoint as not requiring authentication. Use sparingly —
 * only for things like login, OTP request/verify, and health checks.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
