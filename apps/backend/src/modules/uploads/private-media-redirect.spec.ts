import { createPrivateMediaRedirect } from './private-media-redirect';
import { UploadProvider } from './upload-provider.interface';

const GOOD = '123e4567-e89b-12d3-a456-426614174000.png';

function run(handler: ReturnType<typeof createPrivateMediaRedirect>, method: string, path: string) {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 0,
    location: undefined as string | undefined,
    setHeader: (k: string, v: string) => { headers[k] = v; },
    status: (code: number) => { res.statusCode = code; return res; },
    end: jest.fn(),
    redirect: (code: number, target: string) => { res.statusCode = code; res.location = target; },
  };
  const next = jest.fn();
  handler({ method, path } as any, res, next);
  return { res, next, headers };
}

describe('createPrivateMediaRedirect', () => {
  const provider: UploadProvider = {
    store: jest.fn(),
    createReadUrl: (name: string) => (name === GOOD ? `https://objects.example/b/${name}?X-Amz-Signature=abc` : null),
  };
  const handler = createPrivateMediaRedirect(provider, 300);

  it('302-redirects a valid stored name to the signed URL, nosniff and privately cacheable for less than the URL lives', () => {
    const { res, headers } = run(handler, 'GET', `/${GOOD}`);
    expect(res.statusCode).toBe(302);
    expect(res.location).toBe(`https://objects.example/b/${GOOD}?X-Amz-Signature=abc`);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Cache-Control']).toBe('private, max-age=270');
  });

  it('HEAD is handled too', () => {
    expect(run(handler, 'HEAD', `/${GOOD}`).res.statusCode).toBe(302);
  });

  it.each(['/', '/..', '/../x.png', '/a/b.png', `/${GOOD}.html`, '/%2e%2e%2f' + GOOD, '/%E0%A4%A'])('404s anything that is not an exact stored name: %s', (path) => {
    const { res } = run(handler, 'GET', path);
    expect(res.statusCode).toBe(404);
    expect(res.location).toBeUndefined();
  });

  it('other methods fall through untouched (no redirect, no 404)', () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const { res, next } = run(handler, method, `/${GOOD}`);
      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(0);
    }
  });

  it('a provider with no createReadUrl never redirects', () => {
    const h = createPrivateMediaRedirect({ store: jest.fn() } as any, 300);
    expect(run(h, 'GET', `/${GOOD}`).res.statusCode).toBe(404);
  });
});
