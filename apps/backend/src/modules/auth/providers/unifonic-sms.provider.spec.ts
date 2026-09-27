import { UnifonicSmsProvider } from './unifonic-sms.provider';

function buildProvider(config: Record<string, string | undefined> = { 'sms.unifonicAppSid': 'app-sid', 'sms.unifonicSenderId': 'Hatly' }) {
  const configService = { get: jest.fn((key: string) => config[key]) };
  const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
  return new UnifonicSmsProvider(configService as any, requestContextService as any);
}

function mockFetchOnce(impl: (...args: any[]) => Promise<any>) {
  (global as any).fetch = jest.fn(impl);
}

describe('UnifonicSmsProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as any).fetch;
  });

  it('returns success with the providerMessageId on a valid response', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { MessageID: 'msg-123' } }),
    }));
    const provider = buildProvider();
    const result = await provider.sendSms({ to: '+201000000001', body: 'Hatly verification code: 123456' });
    expect(result).toEqual({ success: true, providerMessageId: 'msg-123' });
  });

  it('sends the recipient in normalized (no +) format and the message body unchanged', async () => {
    let capturedBody: string | undefined;
    mockFetchOnce(async (_url: string, init: any) => {
      capturedBody = init.body;
      return { ok: true, json: async () => ({ data: { MessageID: 'm1' } }) };
    });
    const provider = buildProvider();
    await provider.sendSms({ to: '+201000000002', body: 'Hatly verification code: 654321' });
    const params = new URLSearchParams(capturedBody);
    expect(params.get('Recipient')).toBe('201000000002');
    expect(params.get('Body')).toBe('Hatly verification code: 654321');
    expect(params.get('AppSid')).toBe('app-sid');
    expect(params.get('SenderID')).toBe('Hatly');
  });

  it('CRITICAL: returns failure (never throws, never fabricates success) on a non-OK HTTP response', async () => {
    mockFetchOnce(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const provider = buildProvider();
    const result = await provider.sendSms({ to: '+201000000003', body: 'x' });
    expect(result.success).toBe(false);
  });

  it('CRITICAL: returns failure on a timeout, never hangs indefinitely', async () => {
    mockFetchOnce((_url: string, init: any) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err: any = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const provider = buildProvider();
    // Force a near-immediate abort rather than waiting the real 10s
    // timeout — but the callback must still run asynchronously (via the
    // real setTimeout with a 0ms delay), not synchronously. Calling it
    // synchronously would fire the abort before sendSms() even calls
    // fetch(), i.e. before the mock's `abort` listener is registered,
    // leaving the mocked fetch's Promise to hang forever.
    const originalSetTimeout = global.setTimeout;
    (global as any).setTimeout = ((fn: () => void) => originalSetTimeout(fn, 0)) as any;
    try {
      const result = await provider.sendSms({ to: '+201000000004', body: 'x' });
      expect(result.success).toBe(false);
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  it('CRITICAL: returns failure on a malformed (non-JSON) response', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => {
        throw new Error('invalid json');
      },
    }));
    const provider = buildProvider();
    const result = await provider.sendSms({ to: '+201000000005', body: 'x' });
    expect(result.success).toBe(false);
  });

  it('CRITICAL: returns failure when the response is missing MessageID', async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => ({ data: {} }) }));
    const provider = buildProvider();
    const result = await provider.sendSms({ to: '+201000000006', body: 'x' });
    expect(result.success).toBe(false);
  });

  it('CRITICAL: returns failure (never throws) when UNIFONIC_APP_SID/SENDER_ID are missing — no silent fake success', async () => {
    const provider = buildProvider({});
    const fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;
    const result = await provider.sendSms({ to: '+201000000007', body: 'x' });
    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never includes AppSid/credentials in a thrown error or exposed result', async () => {
    mockFetchOnce(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    const provider = buildProvider();
    const result = await provider.sendSms({ to: '+201000000008', body: 'x' });
    expect(JSON.stringify(result)).not.toContain('app-sid');
  });

  it('G (Group 4): an HTTP failure logs a structured external_provider.failed event with provider/operation/correlationId/safe reason, and never the AppSid or the phone number', async () => {
    mockFetchOnce(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const provider = buildProvider();
    const errorSpy = jest.spyOn((provider as any).logger, 'error').mockImplementation(() => undefined);

    await provider.sendSms({ to: '+201000000009', body: 'Hatly verification code: 111111' });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged).toEqual({
      event: 'external_provider.failed',
      correlationId: 'corr-test',
      provider: 'unifonic',
      operation: 'send_sms',
      reason: 'http_503',
    });
    expect(JSON.stringify(logged)).not.toContain('app-sid');
    expect(JSON.stringify(logged)).not.toContain('201000000009');
  });
});
