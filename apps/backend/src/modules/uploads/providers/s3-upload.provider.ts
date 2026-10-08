import * as http from 'http';
import * as https from 'https';
import { Logger } from '@nestjs/common';
import { UploadProvider, UploadResult } from '../upload-provider.interface';
import { CONTENT_TYPE_BY_EXTENSION, newStoredFileName, safeExtensionOf, STORED_FILE_NAME } from './storage-keys';
import { encodeRfc3986, presignGetUrl, signRequestHeaders } from './sigv4';

/**
 * S3-compatible object storage provider (M5 Batch 2) — AWS S3 or any S3-API store (MinIO, R2, Spaces, …), selected purely by
 * configuration (`STORAGE_DRIVER=s3` + `STORAGE_*`, see configuration.ts / env.validation.ts). No provider name or credential is
 * hardcoded; the secret key never leaves this process and is never returned, logged or embedded in a URL.
 *
 * Access model:
 *  - `private` (default; what production should use): the bucket stays private. `store()` returns a STABLE reference
 *    (`<publicUrlPrefix>/<uuid>.<ext>`, the same shape the local provider returns, so existing Upload rows/consumers and the
 *    Flutter media resolver are unaffected). Reading goes through the API (`GET /uploads/files/<name>`), which 302-redirects to a
 *    short-lived signed GET URL (`createReadUrl`) — see private-media-redirect.ts.
 *  - `public` (bucket/CDN is public by policy): `store()` returns the absolute public URL; nothing is signed or redirected.
 * Objects are written without any ACL — bucket policy decides exposure; the API never marks anything public-read itself.
 */
export interface S3UploadSettings {
  /** Optional: omit for AWS S3 (derived from the region). Set for MinIO/R2/etc. */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** `https://host/bucket/key` (true) vs `https://bucket.host/key` (false). Custom endpoints such as MinIO usually need true. */
  forcePathStyle: boolean;
  access: 'private' | 'public';
  /** Required when access=public: the absolute base URL objects are publicly readable at (bucket or CDN). */
  publicBaseUrl?: string;
  signedUrlTtlSeconds: number;
  /** Optional folder prefix inside the bucket (e.g. `hatly/`). */
  keyPrefix: string;
  /** Path prefix of the stored reference in private mode (shared with the local provider: `/uploads/files`). */
  publicUrlPrefix: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

export class S3UploadProvider implements UploadProvider {
  private readonly logger = new Logger('S3UploadProvider');

  constructor(private readonly settings: S3UploadSettings) {}

  private get host(): { origin: string; hostForSigning: string; pathPrefix: string[] } {
    const s = this.settings;
    const base = new URL(s.endpoint && s.endpoint.trim() !== '' ? s.endpoint : `https://s3.${s.region}.amazonaws.com`);
    const pathStyle = s.forcePathStyle || !!(s.endpoint && /^(\d{1,3}\.){3}\d{1,3}$|^localhost$/i.test(base.hostname));
    if (pathStyle) return { origin: base.origin, hostForSigning: base.host, pathPrefix: [s.bucket] };
    const virtual = new URL(base.origin);
    virtual.hostname = `${s.bucket}.${base.hostname}`;
    return { origin: virtual.origin, hostForSigning: virtual.host, pathPrefix: [] };
  }

  private objectSegments(fileName: string): string[] {
    const prefixSegments = this.settings.keyPrefix.split('/').filter(Boolean);
    return [...this.host.pathPrefix, ...prefixSegments, fileName];
  }

  async store(params: { base64Content: string; filename: string }): Promise<UploadResult> {
    const extension = safeExtensionOf(params.filename);
    const contentType = CONTENT_TYPE_BY_EXTENSION[extension];
    if (!contentType) throw new Error('Refusing to store a file without an allowed image extension.');
    const fileName = newStoredFileName(params.filename);
    const body = Buffer.from(params.base64Content, 'base64');
    const { origin, hostForSigning } = this.host;
    const segments = this.objectSegments(fileName);

    const headers = signRequestHeaders({
      method: 'PUT',
      host: hostForSigning,
      rawPathSegments: segments,
      payload: body,
      extraHeaders: { 'content-type': contentType, 'cache-control': this.settings.access === 'public' ? 'public, max-age=31536000, immutable' : 'private, max-age=31536000, immutable' },
      credentials: this.settings,
    });
    const url = new URL(origin);
    url.pathname = '/' + segments.map(encodeRfc3986).join('/');
    const response = await this.request('PUT', url, { ...headers, 'content-length': String(body.length) }, body);
    if (response.status < 200 || response.status >= 300) {
      // Status only: the response body of a failed signed request can echo request details, and nothing here is ever logged with credentials.
      this.logger.error(`Object storage rejected an upload (HTTP ${response.status}).`);
      throw new Error('Object storage upload failed.');
    }

    if (this.settings.access === 'public') {
      const base = (this.settings.publicBaseUrl ?? '').replace(/\/+$/, '');
      const prefix = this.settings.keyPrefix.split('/').filter(Boolean).join('/');
      return { url: `${base}/${prefix ? `${prefix}/` : ''}${fileName}` };
    }
    return { url: `${this.settings.publicUrlPrefix}/${fileName}` };
  }

  /** Short-lived signed GET URL for a stored file name; null for any name this provider could not have issued. */
  createReadUrl(fileName: string): string | null {
    if (!STORED_FILE_NAME.test(fileName)) return null;
    return presignGetUrl({
      origin: this.host.origin,
      rawPathSegments: this.objectSegments(fileName),
      expiresSeconds: this.settings.signedUrlTtlSeconds,
      credentials: this.settings,
    });
  }

  private request(method: string, url: URL, headers: Record<string, string>, body: Buffer): Promise<{ status: number }> {
    const transport = url.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
      const req = transport.request(url, { method, headers, timeout: REQUEST_TIMEOUT_MS }, (res) => {
        res.resume(); // the response body is intentionally not read or kept
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      });
      req.on('timeout', () => req.destroy(new Error('Object storage request timed out.')));
      req.on('error', (error) => reject(new Error(`Object storage request failed: ${error.message}`)));
      req.end(body);
    });
  }
}
