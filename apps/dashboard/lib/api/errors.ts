/**
 * The backend's error envelope is `{ error: { code, message, details } }` (HttpExceptionFilter). Admin pages used to read
 * `response.data.message` — a field that never exists — so every server explanation ("This driver is not online", "This
 * order cannot be reassigned: it is PICKED_UP…") was replaced by a generic fallback. This is the one place that reads it.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: any }; code?: string; message?: string } | null;
  if (!e?.response) {
    // No HTTP response at all — the request never reached / returned from the server.
    return e?.code === 'ERR_NETWORK' ? 'Could not reach the server. Check your connection and try again.' : fallback;
  }
  const data = e.response.data;
  const message = data?.error?.message ?? data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.trim()) return message;
  if (e.response.status === 403) return 'You do not have permission to perform this action.';
  return fallback;
}

/** The machine-readable code of a backend business error (`error.details.code`), or null. */
export function apiErrorCode(err: unknown): string | null {
  const data = (err as { response?: { data?: any } } | null)?.response?.data;
  return data?.error?.details?.code ?? null;
}
