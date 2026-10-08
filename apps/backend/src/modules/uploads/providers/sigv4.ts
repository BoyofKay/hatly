import { createHash, createHmac } from 'crypto';

/**
 * AWS Signature Version 4 for S3-compatible object storage (M5 Batch 2) — header-signed requests (PutObject) and query-signed
 * ("presigned") GET URLs. Implemented directly on Node's `crypto` so the storage provider adds no SDK dependency to a
 * security-sensitive path; correctness is pinned to AWS's own published test vectors (see sigv4.spec.ts).
 *
 * Only what the storage provider needs: service `s3`, path built from RAW key segments (encoded exactly once, as S3 requires),
 * `UNSIGNED-PAYLOAD` for presigned GETs.
 */
export interface SigV4Credentials {
  accessKey: string;
  secretKey: string;
  region: string;
}

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();

/** RFC 3986 percent-encoding (what SigV4 requires: unreserved characters only). */
export const encodeRfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** `/seg1/seg2` from RAW (unencoded) segments, each encoded once. */
export const canonicalPath = (rawSegments: string[]): string => '/' + rawSegments.map(encodeRfc3986).join('/');

const canonicalQuery = (query: Record<string, string>): string =>
  Object.entries(query)
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

export const amzDateOf = (date: Date): string => date.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20130524T000000Z
const dateStampOf = (amzDate: string): string => amzDate.slice(0, 8);

const signingKey = (secretKey: string, dateStamp: string, region: string): Buffer =>
  hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), 's3'), 'aws4_request');

function signature(params: {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>; // lowercase names
  signedHeaders: string[]; // lowercase, sorted
  payloadHash: string;
  credentials: SigV4Credentials;
  amzDate: string;
}): string {
  const canonicalHeaders = params.signedHeaders.map((h) => `${h}:${params.headers[h].trim().replace(/\s+/g, ' ')}\n`).join('');
  const canonicalRequest = [
    params.method,
    params.path,
    canonicalQuery(params.query),
    canonicalHeaders,
    params.signedHeaders.join(';'),
    params.payloadHash,
  ].join('\n');
  const dateStamp = dateStampOf(params.amzDate);
  const scope = `${dateStamp}/${params.credentials.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', params.amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  return createHmac('sha256', signingKey(params.credentials.secretKey, dateStamp, params.credentials.region)).update(stringToSign).digest('hex');
}

/** Headers (including `Authorization`) for a signed S3 request. `host` and the x-amz headers are added here; extra headers are signed too. */
export function signRequestHeaders(params: {
  method: string;
  host: string;
  rawPathSegments: string[];
  payload: Buffer;
  extraHeaders?: Record<string, string>;
  credentials: SigV4Credentials;
  now?: Date;
}): Record<string, string> {
  const amzDate = amzDateOf(params.now ?? new Date());
  const payloadHash = sha256Hex(params.payload);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(params.extraHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    host: params.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaders = Object.keys(headers).sort();
  const sig = signature({
    method: params.method,
    path: canonicalPath(params.rawPathSegments),
    query: {},
    headers,
    signedHeaders,
    payloadHash,
    credentials: params.credentials,
    amzDate,
  });
  const scope = `${dateStampOf(amzDate)}/${params.credentials.region}/s3/aws4_request`;
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${params.credentials.accessKey}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${sig}`,
  };
}

/** A query-signed GET URL valid for `expiresSeconds`. `origin` e.g. `https://bucket.s3.eu-west-1.amazonaws.com`. */
export function presignGetUrl(params: {
  origin: string;
  rawPathSegments: string[];
  expiresSeconds: number;
  credentials: SigV4Credentials;
  now?: Date;
}): string {
  const url = new URL(params.origin);
  const amzDate = amzDateOf(params.now ?? new Date());
  const scope = `${dateStampOf(amzDate)}/${params.credentials.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${params.credentials.accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(params.expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const path = canonicalPath(params.rawPathSegments);
  const sig = signature({
    method: 'GET',
    path,
    query,
    headers: { host: url.host },
    signedHeaders: ['host'],
    payloadHash: 'UNSIGNED-PAYLOAD',
    credentials: params.credentials,
    amzDate,
  });
  return `${url.origin}${path}?${canonicalQuery(query)}&X-Amz-Signature=${sig}`;
}
