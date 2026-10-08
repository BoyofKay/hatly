import { canonicalPath, encodeRfc3986, presignGetUrl, sha256Hex, signRequestHeaders } from './sigv4';

/** AWS's own documented examples (Signature Version 4 for S3: "Authenticating Requests: Using Query Parameters" and "Using the Authorization Header"). */
const AWS_EXAMPLE = {
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
};
const AWS_EXAMPLE_TIME = new Date('2013-05-24T00:00:00Z');

describe('SigV4 — AWS published test vectors', () => {
  it('query-signed GET (presigned URL) matches the AWS documentation example signature', () => {
    const url = presignGetUrl({
      origin: 'https://examplebucket.s3.amazonaws.com',
      rawPathSegments: ['test.txt'],
      expiresSeconds: 86400,
      credentials: AWS_EXAMPLE,
      now: AWS_EXAMPLE_TIME,
    });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('header-signed PUT (with an extra signed header) matches the AWS documentation example signature', () => {
    const headers = signRequestHeaders({
      method: 'PUT',
      host: 'examplebucket.s3.amazonaws.com',
      rawPathSegments: ['test$file.text'],
      payload: Buffer.from('Welcome to Amazon S3.'),
      extraHeaders: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      credentials: AWS_EXAMPLE,
      now: AWS_EXAMPLE_TIME,
    });
    expect(headers['x-amz-content-sha256']).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,' +
        ' SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,' +
        ' Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
  });
});

describe('SigV4 — encoding and secrecy', () => {
  it('encodes exactly once, RFC 3986 style (keys with spaces/special characters are signed as S3 expects)', () => {
    expect(encodeRfc3986("a b!'()*~-_.")).toBe('a%20b%21%27%28%29%2A~-_.');
    expect(canonicalPath(['uploads', 'a b', 'c$d.png'])).toBe('/uploads/a%20b/c%24d.png');
  });

  it('a presigned URL never contains the secret key, and different times/keys give different signatures', () => {
    const a = presignGetUrl({ origin: 'https://b.s3.amazonaws.com', rawPathSegments: ['k.png'], expiresSeconds: 300, credentials: AWS_EXAMPLE, now: AWS_EXAMPLE_TIME });
    const b = presignGetUrl({ origin: 'https://b.s3.amazonaws.com', rawPathSegments: ['k.png'], expiresSeconds: 300, credentials: AWS_EXAMPLE, now: new Date('2013-05-24T00:00:01Z') });
    const c = presignGetUrl({ origin: 'https://b.s3.amazonaws.com', rawPathSegments: ['other.png'], expiresSeconds: 300, credentials: AWS_EXAMPLE, now: AWS_EXAMPLE_TIME });
    expect(a).not.toContain(AWS_EXAMPLE.secretKey);
    expect(a).not.toContain(encodeURIComponent(AWS_EXAMPLE.secretKey));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('sha256Hex of an empty payload is the well-known constant', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
