import { API_BASE_URL } from './api/client';

/**
 * Uploaded media is stored as a server-relative reference (`/uploads/files/<name>`) that the BACKEND serves, so on this dashboard's
 * origin it must be resolved against the API origin; an already-absolute URL (public object storage) is used as is.
 */
export function resolveMediaUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, API_BASE_URL).toString();
  } catch {
    return url;
  }
}
