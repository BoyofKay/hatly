import { DeviceTokensController } from './device-tokens.controller';

describe('DeviceTokensController', () => {
  it('registers the token using ONLY the authenticated caller\u2019s id — never a client-supplied user id (no such field exists on the DTO/call)', async () => {
    const deviceTokensService = { registerToken: jest.fn(async () => undefined) };
    const controller = new DeviceTokensController(deviceTokensService as any);

    await controller.register({ id: 'user-1', role: 'DRIVER' } as any, { token: 'tok', platform: 'android' } as any);

    expect(deviceTokensService.registerToken).toHaveBeenCalledWith({
      userId: 'user-1',
      token: 'tok',
      platform: 'android',
    });
  });
});
