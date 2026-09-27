import { CustomerDeviceTokensController } from './customer-device-tokens.controller';

describe('CustomerDeviceTokensController', () => {
  it('CRITICAL: registers the token using ONLY the authenticated caller\u2019s id — never a client-supplied user id (no such field exists on the DTO/call)', async () => {
    const deviceTokensService = { registerToken: jest.fn(async () => undefined) };
    const controller = new CustomerDeviceTokensController(deviceTokensService as any);

    await controller.register({ id: 'customer-1', role: 'CUSTOMER' } as any, {
      token: 'tok',
      platform: 'android',
    } as any);

    expect(deviceTokensService.registerToken).toHaveBeenCalledWith({
      userId: 'customer-1',
      token: 'tok',
      platform: 'android',
    });
  });

  it('returns the same response shape as the existing Driver endpoint', async () => {
    const deviceTokensService = { registerToken: jest.fn(async () => undefined) };
    const controller = new CustomerDeviceTokensController(deviceTokensService as any);

    const result = await controller.register({ id: 'customer-1', role: 'CUSTOMER' } as any, {
      token: 'tok',
      platform: 'ios',
    } as any);

    expect(result).toEqual({ message: 'Device registered.' });
  });
});
