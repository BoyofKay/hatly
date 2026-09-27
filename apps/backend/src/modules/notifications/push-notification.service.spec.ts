import { PushNotificationService } from './push-notification.service';

function buildHarness(opts: { tokens?: string[]; providerResult?: any } = {}) {
  const deviceTokensService = {
    getActiveTokensForUser: jest.fn(async () => opts.tokens ?? ['token-1']),
    deactivateTokens: jest.fn(async () => undefined),
  };
  const provider = {
    sendToTokens: jest.fn(
      async (_params: { tokens: string[]; title: string; body: string; data: Record<string, string> }) =>
        opts.providerResult ?? { success: true, invalidTokens: [] },
    ),
  };
  const service = new PushNotificationService(deviceTokensService as any, provider as any);
  return { service, deviceTokensService, provider };
}

describe('PushNotificationService', () => {
  it('sends the confirmed payload shape: type ORDER_ASSIGNED, the real orderId, and deliveryId (for the existing Driver route)', async () => {
    const { service, provider } = buildHarness();
    await service.sendOrderAssignedNotification('user-1', 'order-123', 'delivery-123');
    expect(provider.sendToTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { type: 'ORDER_ASSIGNED', orderId: 'order-123', deliveryId: 'delivery-123' },
      }),
    );
  });

  it('does not call the provider at all when the user has no registered device', async () => {
    const { service, provider } = buildHarness({ tokens: [] });
    await service.sendOrderAssignedNotification('user-1', 'order-1', 'delivery-1');
    expect(provider.sendToTokens).not.toHaveBeenCalled();
  });

  it('deactivates only the tokens the provider reports invalid', async () => {
    const { service, deviceTokensService } = buildHarness({
      providerResult: { success: true, invalidTokens: ['token-1'] },
    });
    await service.sendOrderAssignedNotification('user-1', 'order-1', 'delivery-1');
    expect(deviceTokensService.deactivateTokens).toHaveBeenCalledWith(['token-1']);
  });

  it('CRITICAL: never throws when the provider reports failure — the caller (assignment flow) must never be affected', async () => {
    const { service } = buildHarness({ providerResult: { success: false, invalidTokens: [] } });
    await expect(service.sendOrderAssignedNotification('user-1', 'order-1', 'delivery-1')).resolves.toBeUndefined();
  });

  it('CRITICAL: never throws even when the provider itself throws unexpectedly', async () => {
    const deviceTokensService = {
      getActiveTokensForUser: jest.fn(async () => ['token-1']),
      deactivateTokens: jest.fn(async () => undefined),
    };
    const provider = {
      sendToTokens: jest.fn(async () => {
        throw new Error('unexpected');
      }),
    };
    const service = new PushNotificationService(deviceTokensService as any, provider as any);
    await expect(service.sendOrderAssignedNotification('user-1', 'order-1', 'delivery-1')).resolves.toBeUndefined();
  });

  it('title/body use plain operational wording, never "awaiting acceptance"', async () => {
    const { service, provider } = buildHarness();
    await service.sendOrderAssignedNotification('user-1', 'order-1', 'delivery-1');
    const call = provider.sendToTokens.mock.calls[0][0];
    expect(call.title).toBe('New Delivery');
    expect(call.body.toLowerCase()).not.toContain('accept');
  });
});
