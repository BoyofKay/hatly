import * as http from 'http';
import { AddressInfo } from 'net';
import { sha256Hex, signRequestHeaders, presignGetUrl } from './sigv4';

/**
 * A tiny in-process S3-compatible server for tests (path-style). It does what a real store does that matters to our provider:
 * it VERIFIES every request's signature (header-signed PUT and query-signed GET, including expiry) and the payload hash, and
 * stores/serves object bytes. A request that is unsigned, mis-signed, tampered with or expired is refused with 403 — so a test
 * passing here means the provider's wire format is accepted by a verifying server, with no cloud account.
 */
export interface FakeS3 {
  endpoint: string;
  objects: Map<string, { body: Buffer; contentType: string }>;
  requests: Array<{ method: string; path: string; headers: http.IncomingHttpHeaders }>;
  failNextWith?: number;
  close(): Promise<void>;
}

export const FAKE_S3_CREDENTIALS = { accessKey: 'AKIAFAKEFORTESTS', secretKey: 'fake/secret+key/for/tests/only0123456789', region: 'eu-test-1' };

export async function startFakeS3(bucket = 'hatly-test'): Promise<FakeS3> {
  const state: FakeS3 = { endpoint: '', objects: new Map(), requests: [], close: async () => undefined };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      state.requests.push({ method: req.method ?? '', path: url.pathname, headers: req.headers });
      const reply = (status: number, body?: Buffer, headers: Record<string, string> = {}) => {
        res.writeHead(status, headers);
        res.end(body);
      };
      if (state.failNextWith) {
        const status = state.failNextWith;
        state.failNextWith = undefined;
        return reply(status, Buffer.from('<Error>SECRET-DETAIL-THAT-MUST-NOT-LEAK</Error>'));
      }
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (segments[0] !== bucket || segments.length < 2) return reply(404);
      const objectKey = segments.slice(1).join('/');

      if (req.method === 'PUT') {
        const body = Buffer.concat(chunks);
        const amzDate = String(req.headers['x-amz-date'] ?? '');
        const iso = `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`;
        if (req.headers['x-amz-content-sha256'] !== sha256Hex(body)) return reply(400, Buffer.from('payload hash mismatch'));
        const expected = signRequestHeaders({
          method: 'PUT',
          host: String(req.headers.host),
          rawPathSegments: segments,
          payload: body,
          extraHeaders: { 'content-type': String(req.headers['content-type']), 'cache-control': String(req.headers['cache-control']) },
          credentials: FAKE_S3_CREDENTIALS,
          now: new Date(iso),
        });
        if (req.headers.authorization !== expected.authorization) return reply(403, Buffer.from('SignatureDoesNotMatch'));
        state.objects.set(objectKey, { body, contentType: String(req.headers['content-type']) });
        return reply(200);
      }

      if (req.method === 'DELETE') {
        const amzDate = String(req.headers['x-amz-date'] ?? '');
        const iso = `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`;
        const expected = signRequestHeaders({ method: 'DELETE', host: String(req.headers.host), rawPathSegments: segments, payload: Buffer.alloc(0), credentials: FAKE_S3_CREDENTIALS, now: new Date(iso) });
        if (req.headers.authorization !== expected.authorization) return reply(403, Buffer.from('SignatureDoesNotMatch'));
        state.objects.delete(objectKey);
        return reply(204);
      }

      if (req.method === 'GET') {
        const q = url.searchParams;
        const amzDate = q.get('X-Amz-Date') ?? '';
        const iso = `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`;
        const expires = Number(q.get('X-Amz-Expires'));
        const issuedAt = new Date(iso).getTime();
        if (!Number.isFinite(issuedAt) || Date.now() > issuedAt + expires * 1000) return reply(403, Buffer.from('Request has expired'));
        const expected = presignGetUrl({
          origin: `http://${req.headers.host}`,
          rawPathSegments: segments,
          expiresSeconds: expires,
          credentials: FAKE_S3_CREDENTIALS,
          now: new Date(iso),
        });
        if (new URL(expected).searchParams.get('X-Amz-Signature') !== q.get('X-Amz-Signature')) return reply(403, Buffer.from('SignatureDoesNotMatch'));
        const object = state.objects.get(objectKey);
        return object ? reply(200, object.body, { 'content-type': object.contentType }) : reply(404);
      }
      return reply(405);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  return state;
}
