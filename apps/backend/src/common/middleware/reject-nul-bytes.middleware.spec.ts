import { BadRequestException } from '@nestjs/common';
import { RejectNulBytesMiddleware } from './reject-nul-bytes.middleware';

const run = (req: Record<string, unknown>) => {
  const next = jest.fn();
  new RejectNulBytesMiddleware().use({ query: {}, body: undefined, params: {}, ...req } as never, {} as never, next);
  return next;
};

describe('RejectNulBytesMiddleware', () => {
  it('passes ordinary requests, including unicode and empty bodies', () => {
    expect(run({ query: { q: 'شاورما' }, body: { a: ['x', { b: 'ok' }], n: 1, t: true, z: null } })).toHaveBeenCalledTimes(1);
    expect(run({})).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['query', { query: { q: 'a\u0000b' } }],
    ['nested body value', { body: { a: [{ b: 'x\u0000' }] } }],
    ['body key', { body: { 'k\u0000ey': 1 } }],
    ['path param', { params: { id: '1\u0000' } }],
  ])('rejects a NUL byte in the %s with INVALID_CHARACTER', (_name, req) => {
    try {
      run(req);
      fail('expected BadRequestException');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ details: { code: 'INVALID_CHARACTER' } });
    }
  });
});
