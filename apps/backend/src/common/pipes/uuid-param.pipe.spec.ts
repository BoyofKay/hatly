import { BadRequestException } from '@nestjs/common';
import { UuidParamPipe } from './uuid-param.pipe';

const pipe = new UuidParamPipe();
const param = (data: string) => ({ type: 'param' as const, data });
const VALID = '6b1f2c9e-4d5a-4b7e-8a3c-0f9d2e1a7b64';

describe('UuidParamPipe', () => {
  it.each(['id', 'orderId', 'itemId', 'employeeUserId'])('accepts a UUID for %s', (name) => {
    expect(pipe.transform(VALID, param(name))).toBe(VALID);
  });

  it.each(['not-a-uuid', '', '123', "1' OR '1'='1", `${VALID}x`, 'dispatchable'])('rejects %p with a 400 carrying a stable code', (bad) => {
    try {
      pipe.transform(bad, param('id'));
      fail('expected a BadRequestException');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ details: { code: 'INVALID_IDENTIFIER', param: 'id' } });
    }
  });

  it('leaves non-identifier params, query and body untouched', () => {
    expect(pipe.transform('MANAGE_VENDORS', param('permission'))).toBe('MANAGE_VENDORS');
    expect(pipe.transform('REGISTERED_VENDOR_PRICE_PER_100M_MINOR', param('key'))).toBe('REGISTERED_VENDOR_PRICE_PER_100M_MINOR');
    expect(pipe.transform('x', { type: 'query', data: 'id' })).toBe('x');
    expect(pipe.transform({ id: 'x' }, { type: 'body' })).toEqual({ id: 'x' });
  });
});
