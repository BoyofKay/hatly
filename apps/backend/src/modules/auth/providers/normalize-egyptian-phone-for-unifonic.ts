/**
 * Unifonic requires international format WITHOUT a leading '+' or '00'
 * (per its official REST SMS API documentation). Hatly's own stored
 * `User.phone` values are already validated as Egyptian E.164
 * (`@IsPhoneNumber('EG')`, typically `+20...`) — no general-purpose
 * phone-normalization utility exists anywhere else in this backend to
 * reuse, so this is a small, provider-specific formatting step, not a
 * duplicate of validation. Deliberately conservative: an input that's
 * already in the bare `20...` form is left untouched rather than
 * altered, per the explicit "do not blindly alter an already-valid
 * international number" instruction.
 */
export function normalizeEgyptianPhoneForUnifonic(phone: string): string {
  if (phone.startsWith('+')) {
    return phone.slice(1);
  }
  if (phone.startsWith('0020')) {
    return phone.slice(2);
  }
  return phone;
}
