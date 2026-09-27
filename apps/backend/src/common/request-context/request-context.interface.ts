/**
 * Deliberately minimal — only what's genuinely useful and safe to
 * carry through every async continuation of a request. NEVER add
 * passwords, OTPs, authorization tokens, cookies, request bodies, or
 * any other sensitive value here: this object is read from deep
 * service code and error logs, both far from the HTTP boundary where
 * such data would normally be handled carefully.
 */
export interface RequestContext {
  correlationId: string;
  method: string;
  path: string;
}
