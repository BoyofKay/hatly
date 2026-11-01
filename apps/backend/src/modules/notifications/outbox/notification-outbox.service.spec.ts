import { NotificationOutboxService } from './notification-outbox.service';

/**
 * The delivery state machine, without a database: leases, outcomes, back-off, honesty about the provider. (The same behaviour is exercised
 * against real PostgreSQL, with concurrent workers, in test/e2e/126-notification-outbox-and-staff-alerts.)
 */
describe('NotificationOutboxService worker', () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: 'r1', event_key: 'e:1', recipient_user_id: 'u1', channel: 'PUSH', title: 't', body: 'b', data: { type: 'X' }, attempts: 1, max_attempts: 5, ...over });

  function setup(rows: any[], opts: { affected?: number; tokens?: string[]; provider?: any } = {}) {
    const updates: Array<{ sql: string; params: unknown[] }> = [];
    const ds = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        if (/SET status = 'SENDING'/.test(sql)) return [rows, rows.length];
        updates.push({ sql, params });
        return [[], opts.affected ?? 1];
      }),
    };
    const deviceTokens = { getActiveTokensForUser: jest.fn().mockResolvedValue(opts.tokens ?? ['tok']), deactivateTokens: jest.fn().mockResolvedValue(undefined) };
    const provider = opts.provider ?? { sendToTokens: jest.fn().mockResolvedValue({ success: true, invalidTokens: [] }) };
    return { service: new NotificationOutboxService(ds as any, deviceTokens as any, provider), ds, deviceTokens, provider, updates };
  }

  it('records SENT only while it still holds the lease, and sends the event key with the push so a repeat can be ignored', async () => {
    const t = setup([row()]);
    expect(await t.service.processBatch()).toMatchObject({ claimed: 1, sent: 1, lostLease: 0 });
    expect(t.updates[0].sql).toContain("status = 'SENT'");
    expect(t.updates[0].sql).toContain('lock_token = $2');
    expect(t.provider.sendToTokens).toHaveBeenCalledWith({ tokens: ['tok'], title: 't', body: 'b', data: { type: 'X', eventKey: 'e:1' } });
  });

  it('a worker that lost its lease (another worker took the row over) does not count or overwrite the result', async () => {
    const t = setup([row()], { affected: 0 });
    expect(await t.service.processBatch()).toMatchObject({ claimed: 1, sent: 0, lostLease: 1 });
  });

  it('an unconfigured provider is SKIPPED with a reason and is never called', async () => {
    const provider = { isConfigured: () => false, sendToTokens: jest.fn() };
    const t = setup([row()], { provider });
    expect(await t.service.processBatch()).toMatchObject({ skipped: 1, sent: 0 });
    expect(t.updates[0].params).toContain('PROVIDER_NOT_CONFIGURED');
    expect(provider.sendToTokens).not.toHaveBeenCalled();
    expect(t.service.providers().push.configured).toBe(false);
  });

  it('WhatsApp, SMS and e-mail are not configured anywhere: such rows are SKIPPED, never "sent"', async () => {
    for (const channel of ['WHATSAPP', 'SMS', 'EMAIL']) {
      const t = setup([row({ channel })]);
      expect(await t.service.processBatch()).toMatchObject({ skipped: 1, sent: 0 });
      expect(t.updates[0].params).toContain('PROVIDER_NOT_CONFIGURED');
      expect(t.provider.sendToTokens).not.toHaveBeenCalled();
    }
    expect(setup([]).service.providers()).toMatchObject({ whatsapp: { configured: false }, sms: { configured: false }, email: { configured: false } });
  });

  it('retries with exponential back-off (30s, 60s, 120s … capped at 1h) and ends in DEAD when the attempts are used up', async () => {
    const delays: string[] = [];
    for (const attempts of [1, 2, 3, 12]) {
      const t = setup([row({ attempts, max_attempts: 20 })], { provider: { sendToTokens: jest.fn().mockResolvedValue({ success: false, invalidTokens: [] }) } });
      expect(await t.service.processBatch()).toMatchObject({ retried: 1 });
      delays.push(String(t.updates[0].params[3]));
    }
    expect(delays).toEqual(['30', '60', '120', '3600']);
    const dead = setup([row({ attempts: 5, max_attempts: 5 })], { provider: { sendToTokens: jest.fn().mockRejectedValue(new Error('boom')) } });
    expect(await dead.service.processBatch()).toMatchObject({ dead: 1, retried: 0 });
    expect(dead.updates[0].sql).toContain("status = 'DEAD'");
    expect(String(dead.updates[0].params[2])).toContain('PROVIDER_ERROR: boom');
  });

  it('a lease that expired on the last allowed attempt is not sent again: it is DEAD', async () => {
    const t = setup([row({ attempts: 6, max_attempts: 5 })]);
    expect(await t.service.processBatch()).toMatchObject({ dead: 1, sent: 0 });
    expect(t.provider.sendToTokens).not.toHaveBeenCalled();
  });

  it('only the tokens the provider reported invalid are deactivated', async () => {
    const provider = { sendToTokens: jest.fn().mockResolvedValue({ success: true, invalidTokens: ['bad'] }) };
    const t = setup([row()], { tokens: ['good', 'bad'], provider });
    await t.service.processBatch();
    expect(t.deviceTokens.deactivateTokens).toHaveBeenCalledWith(['bad']);
  });

  it('enqueue never throws: a database failure is logged and reported as "not written"', async () => {
    const service = new NotificationOutboxService({} as any, {} as any, { sendToTokens: jest.fn() });
    const manager = { transaction: jest.fn().mockRejectedValue(new Error('down')) } as any;
    await expect(service.enqueue(manager, { eventKey: 'k', recipientUserId: 'u', recipientKind: 'CUSTOMER', category: 'C', title: 't', body: 'b' })).resolves.toBe(false);
  });
});
