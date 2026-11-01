import { SetMetadata } from '@nestjs/common';

export const CSRF_MODE_KEY = 'csrfMode';
/**
 * How a COOKIE-authenticated unsafe request proves it is not a cross-site forgery (bearer-token requests never need this):
 *  - default            the signed `X-CSRF-Token` header (bound to the session cookie);
 *  - 'custom-header'    `X-Requested-With: hatly-dashboard` (used by refresh/logout, which must work when the token was lost);
 *  - 'skip'             no token (sign-in itself: there is no session yet). The Origin check still applies.
 */
export const CsrfMode = (mode: 'custom-header' | 'skip') => SetMetadata(CSRF_MODE_KEY, mode);

export const ALLOW_WITHOUT_MFA_KEY = 'allowWithoutMfa';
/** Routes an admin who has not yet enrolled an authenticator may still call while the enrolment policy is on (enrolment itself, session upkeep). */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA_KEY, true);
