import { of } from 'rxjs';
import { HomeCacheEpochInterceptor, isHomeCatalogueMutation } from './home-cache-epoch.interceptor';

describe('Home cache epoch — which requests invalidate the Home product rows', () => {
  it.each([
    ['PATCH', '/api/v1/admin/products/123'],
    ['POST', '/api/v1/admin/products'],
    ['POST', '/api/v1/admin/products/123/activate'],
    ['PATCH', '/api/v1/admin/offers/5'],
    ['POST', '/api/v1/admin/offers'],
    ['PATCH', '/api/v1/admin/vendor-branches/9/activate'],
    ['PATCH', '/api/v1/admin/vendors/9'],
    ['PATCH', '/api/v1/admin/sectors/2'],
    ['PATCH', '/api/v1/admin/delivery-zones/2'],
    ['PATCH', '/api/v1/vendor/products/7'],
    ['POST', '/api/v1/vendor/products/7/inventory'],
    ['DELETE', '/api/v1/admin/product-categories/3'],
    ['PATCH', '/api/v1/vendor/branches/me'],
  ])('%s %s bumps the epoch', (method, url) => {
    expect(isHomeCatalogueMutation(method, url)).toBe(true);
  });

  it.each([
    ['GET', '/api/v1/admin/products'],
    ['GET', '/api/v1/home/product-sections'],
    ['POST', '/api/v1/orders'],
    ['POST', '/api/v1/auth/customer/login'],
    ['PATCH', '/api/v1/admin/users/4'],
    ['POST', '/api/v1/cart/items'],
    ['PATCH', '/api/v1/vendor/orders/segments/1/status'],
  ])('%s %s does not', (method, url) => {
    expect(isHomeCatalogueMutation(method, url)).toBe(false);
  });

  const run = (method: string, url: string, outcome: 'ok' | 'error') => {
    const cache = { bumpEpoch: jest.fn(async () => undefined) };
    const interceptor = new HomeCacheEpochInterceptor(cache as never);
    const context = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ method, url, originalUrl: url }) }) };
    const handler = { handle: () => (outcome === 'ok' ? of('done') : new (require('rxjs').Observable)((s: any) => s.error(new Error('fail')))) };
    return new Promise<typeof cache>((resolve) => {
      (interceptor.intercept(context as never, handler as never) as any).subscribe({ complete: () => resolve(cache), error: () => resolve(cache) });
    });
  };

  it('bumps only AFTER a successful mutation — a failed one changed nothing', async () => {
    expect((await run('PATCH', '/api/v1/admin/products/1', 'ok')).bumpEpoch).toHaveBeenCalledTimes(1);
    expect((await run('PATCH', '/api/v1/admin/products/1', 'error')).bumpEpoch).not.toHaveBeenCalled();
    expect((await run('GET', '/api/v1/admin/products/1', 'ok')).bumpEpoch).not.toHaveBeenCalled();
    expect((await run('POST', '/api/v1/orders', 'ok')).bumpEpoch).not.toHaveBeenCalled();
  });
});
