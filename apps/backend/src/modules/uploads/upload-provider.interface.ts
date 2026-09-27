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
}

export const UPLOAD_PROVIDER = Symbol('UPLOAD_PROVIDER');
