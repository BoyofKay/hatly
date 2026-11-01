import * as app from 'firebase-admin/app';
import * as messaging from 'firebase-admin/messaging';
import { FirebasePushNotificationProvider } from './firebase-push.provider';

// The MODULAR API (works unchanged on firebase-admin 12 and 14). `mockApps` is what getApps() returns.
const mockApps: any[] = [];
jest.mock('firebase-admin/app', () => ({
  getApps: jest.fn(() => mockApps),
  initializeApp: jest.fn(() => ({ name: 'mock-app' })),
  cert: jest.fn((c: any) => c),
}));
jest.mock('firebase-admin/messaging', () => ({ getMessaging: jest.fn() }));
const admin = { initializeApp: app.initializeApp, messaging: messaging.getMessaging };

function buildProvider(config: Record<string, string | undefined>) {
  const configService = { get: jest.fn((key: string) => config[key]) };
  const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
  return new FirebasePushNotificationProvider(configService as any, requestContextService as any);
}

describe('FirebasePushNotificationProvider', () => {
  beforeEach(() => {
    mockApps.length = 0;
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
    mockApps.push({ name: 'existing-app' });
    const provider = buildProvider({
      'fcm.projectId': 'p',
      'fcm.clientEmail': 'e',
      'fcm.privateKey': 'k',
    });
    provider.onModuleInit();
    expect(admin.initializeApp).not.toHaveBeenCalled();
  });

  it('initializes ONE app from the configured service account (escaped newlines restored) when none exists', () => {
    const provider = buildProvider({ 'fcm.projectId': 'p', 'fcm.clientEmail': 'e', 'fcm.privateKey': 'line1\\nline2' });
    provider.onModuleInit();
    expect(app.cert).toHaveBeenCalledWith({ projectId: 'p', clientEmail: 'e', privateKey: 'line1\nline2' });
    expect(admin.initializeApp).toHaveBeenCalledTimes(1);
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
