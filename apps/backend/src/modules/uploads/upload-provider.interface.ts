/**
 * Abstraction over wherever uploaded file bytes actually end up.
 * Business logic depends only on this interface (see
 * uploads.service.ts) — never on a concrete provider — matching the
 * existing MapProvider/PaymentProvider pattern from Phase 1. A real
 * S3-compatible implementation (the `.env.example` STORAGE_* vars
 * already reserved for this since Phase 1) can replace
 * StubUploadProvider later without touching UploadsService or
 * anything that calls it.
 */
export interface UploadResult {
  url: string;
}

export interface UploadProvider {
  store(params: { base64Content: string; filename: string }): Promise<UploadResult>;

  /**
   * Providers whose stored references are NOT directly servable (private object storage) implement this: given the file name
   * part of a stored reference (`<uuid>.<ext>`), return a short-lived signed URL to redirect the reader to — or null when the
   * name is not one this provider ever issued. Providers that serve their own references (local disk, public buckets/CDN)
   * omit it. See private-media-redirect.ts.
   */
  createReadUrl?(fileName: string): string | null;

  remove?(storedUrl: string): Promise<boolean>;
}

/**
 * Removes a file this provider stored, given the reference `store` returned. Account deletion uses it to erase a customer's own photos.
 * Resolves `true` when the file is gone afterwards (also when it was already absent), `false` when the reference is not one of this
 * provider's own generated names (never touched) or the removal failed. Never throws.
 */
export interface RemovableUploadProvider {
  remove(storedUrl: string): Promise<boolean>;
}

export const UPLOAD_PROVIDER = Symbol('UPLOAD_PROVIDER');
