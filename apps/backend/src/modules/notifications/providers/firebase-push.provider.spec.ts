import * as admin from 'firebase-admin';
import { FirebasePushNotificationProvider } from './firebase-push.provider';

jest.mock('firebase-admin', () => {
  const mockApp = { name: 'mock-app' };
  return {
    apps: [] as any[],
    initializeApp: jest.fn(() => mockApp),
    credential: { cert: jest.fn((c: any) => c) },
    messaging: jest.fn(),
  };
});

function buildProvider(config: Record<string, string | undefined>) {
  const configService = { get: jest.fn((key: string) => config[key]) };
  const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
  return new FirebasePushNotificationProvider(configService as any, requestContextService as any);
}

describe('FirebasePushNotificationProvider', () => {
  beforeEach(() => {
    (admin as any).apps = [];
    jest.clearAllMocks();
  });

  it('CRITICAL: fails closed (never sends, never throws) when configuration is missing — no fake success', async () => {
    const provider = buildProvider({});
    provider.onModuleInit();
    const result = await provider.sendToTokens({ tokens: ['t1'], title: 'x', body: 'y', data: {} });
    expect(result.success).toBe(false);
    expect(result.invalidTokens).toEqual([]);
  });

  it('CRITICAL: never initializes a second Firebase app if one already exists', () => {
    (admin as any).apps = [{ name: 'existing-app' }];
    const provider = buildProvider({
      'fcm.projectId': 'p',
      'fcm.clientEmail': 'e',
      'fcm.privateKey': 'k',
    });
    provider.onModuleInit();
    expect(admin.initializeApp).not.toHaveBeenCalled();
  });

  it('reports success when Firebase accepts the message', async () => {
    (admin.messaging as jest.Mock).mockReturnValue({
      sendEachForMulticast: jest.fn(async () => ({
        successCount: 1,
        responses: [{ success: true }],
      })),
    });
    const provider = buildProvider({
      'fcm.projectId': 'p',
      'fcm.clientEmail': 'e',
      'fcm.privateKey': 'k',
    });
    provider.onModuleInit();
    const result = await provider.sendToTokens({ tokens: ['t1'], title: 'x', body: 'y', data: {} });
    expect(result.success).toBe(true);
    expect(result.invalidTokens).toEqual([]);
  });

  it('CRITICAL: identifies invalid/unregistered tokens by Firebase\u2019s documented error codes only', async () => {
    (admin.messaging as jest.Mock).mockReturnValue({
      sendEachForMulticast: jest.fn(async () => ({
        successCount: 1,
        responses: [
          { success: false, error: { code: 'messaging/registration-token-not-registered' } },
          { success: true },
          { success: false, error: { code: 'messaging/internal-error' } }, // transient — must NOT be marked invalid
        ],
      })),
    });
    const provider = buildProvider({
      'fcm.projectId': 'p',
      'fcm.clientEmail': 'e',
      'fcm.privateKey': 'k',
    });
    provider.onModuleInit();
    const result = await provider.sendToTokens({
      tokens: ['bad-token', 'good-token', 'transient-fail-token'],
      title: 'x',
      body: 'y',
      data: {},
    });
    expect(result.invalidTokens).toEqual(['bad-token']);
  });

  it('returns failure (never throws) if the Firebase SDK call itself throws', async () => {
    (admin.messaging as jest.Mock).mockReturnValue({
      sendEachForMulticast: jest.fn(async () => {
        throw new Error('network error');
      }),
    });
    const provider = buildProvider({
      'fcm.projectId': 'p',
      'fcm.clientEmail': 'e',
      'fcm.privateKey': 'k',
    });
    provider.onModuleInit();
    const result = await provider.sendToTokens({ tokens: ['t1'], title: 'x', body: 'y', data: {} });
    expect(result.success).toBe(false);
  });

  it('never includes credentials in the returned result', async () => {
    (admin.messaging as jest.Mock).mockReturnValue({
      sendEachForMulticast: jest.fn(async () => ({ successCount: 0, responses: [{ success: false, error: {} }] })),
    });
    const provider = buildProvider({
      'fcm.projectId': 'p',
      'fcm.clientEmail': 'secret-email@example.com',
      'fcm.privateKey': 'SUPER-SECRET-KEY',
    });
    provider.onModuleInit();
    const result = await provider.sendToTokens({ tokens: ['t1'], title: 'x', body: 'y', data: {} });
    expect(JSON.stringify(result)).not.toContain('SUPER-SECRET-KEY');
  });
});
