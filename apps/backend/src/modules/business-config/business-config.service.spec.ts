import { BusinessConfigService } from './business-config.service';
import { BusinessConfigKey } from './business-config-key.enum';

function buildMockRepo(initial: Array<{ id: string; key: string; value: unknown }> = []) {
  const rows = [...initial];
  return {
    findOne: jest.fn(async ({ where }: { where: { key: string } }) => {
      return rows.find((r) => r.key === where.key) ?? null;
    }),
    find: jest.fn(async () => [...rows].sort((a, b) => a.key.localeCompare(b.key))),
    create: jest.fn((data: any) => ({ id: `new-${rows.length}`, ...data })),
    save: jest.fn(async (row: any) => {
      const index = rows.findIndex((r) => r.id === row.id);
      if (index >= 0) rows[index] = row;
      else rows.push(row);
      return row;
    }),
  };
}

describe('BusinessConfigService', () => {
  it('get returns the provided default when the key was never set', async () => {
    const service = new BusinessConfigService(buildMockRepo() as any);
    await expect(service.get('SOME_UNSET_KEY', 'fallback')).resolves.toBe('fallback');
  });

  it('get returns the stored value once set', async () => {
    const repo = buildMockRepo([{ id: 'c1', key: 'SOME_KEY', value: 42 }]);
    const service = new BusinessConfigService(repo as any);
    await expect(service.get<number>('SOME_KEY', 0)).resolves.toBe(42);
  });

  it('set creates a new row when the key does not exist yet', async () => {
    const repo = buildMockRepo();
    const service = new BusinessConfigService(repo as any);

    await service.set('NEW_KEY', { nested: true }, 'admin-1', 'a description');

    expect(repo.create).toHaveBeenCalledWith({ key: 'NEW_KEY' });
    expect(repo.save).toHaveBeenCalledTimes(1);
    await expect(service.get('NEW_KEY', null)).resolves.toEqual({ nested: true });
  });

  it('set overwrites the value on an existing row rather than creating a duplicate', async () => {
    const repo = buildMockRepo([{ id: 'c1', key: 'EXISTING_KEY', value: 'old' }]);
    const service = new BusinessConfigService(repo as any);

    await service.set('EXISTING_KEY', 'new', 'admin-1');

    expect(repo.create).not.toHaveBeenCalled();
    await expect(service.get('EXISTING_KEY', null)).resolves.toBe('new');
  });

  it('isAutomaticDispatchEnabled defaults to true when unset', async () => {
    const service = new BusinessConfigService(buildMockRepo() as any);
    await expect(service.isAutomaticDispatchEnabled()).resolves.toBe(true);
  });

  it('isAutomaticDispatchEnabled reflects a stored false value', async () => {
    const repo = buildMockRepo([
      { id: 'c1', key: BusinessConfigKey.AUTOMATIC_DISPATCH_ENABLED, value: false },
    ]);
    const service = new BusinessConfigService(repo as any);
    await expect(service.isAutomaticDispatchEnabled()).resolves.toBe(false);
  });

  it('getAll returns every stored row', async () => {
    const repo = buildMockRepo([
      { id: 'c1', key: 'A', value: 1 },
      { id: 'c2', key: 'B', value: 2 },
    ]);
    const service = new BusinessConfigService(repo as any);
    const all = await service.getAll();
    expect(all).toHaveLength(2);
  });
  describe('getCustomerSupportWhatsappNumber (Customer Support contact)', () => {
    it('returns the stored number, trimmed', async () => {
      const repo = buildMockRepo([{ id: 'c1', key: BusinessConfigKey.CUSTOMER_SERVICE_WHATSAPP_NUMBER, value: ' +201000000000 ' }]);
      const service = new BusinessConfigService(repo as any);
      await expect(service.getCustomerSupportWhatsappNumber()).resolves.toBe('+201000000000');
    });

    it('returns null — never throws — when the key was never set', async () => {
      const service = new BusinessConfigService(buildMockRepo() as any);
      await expect(service.getCustomerSupportWhatsappNumber()).resolves.toBeNull();
    });

    it.each([['blank string', '   '], ['empty string', ''], ['number', 201000000000], ['object', { n: 1 }], ['null', null]])(
      'returns null for a %s value',
      async (_label, value) => {
        const repo = buildMockRepo([{ id: 'c1', key: BusinessConfigKey.CUSTOMER_SERVICE_WHATSAPP_NUMBER, value }]);
        const service = new BusinessConfigService(repo as any);
        await expect(service.getCustomerSupportWhatsappNumber()).resolves.toBeNull();
      },
    );

    it('does not read the Manual Transfer destination, and the Manual Transfer getter still fails closed when unset', async () => {
      const repo = buildMockRepo([{ id: 'c1', key: BusinessConfigKey.CUSTOMER_SERVICE_WHATSAPP_NUMBER, value: '+201000000000' }]);
      const service = new BusinessConfigService(repo as any);
      await service.getCustomerSupportWhatsappNumber();
      const queriedKeys = repo.findOne.mock.calls.map(([arg]: any) => arg.where.key);
      expect(queriedKeys).toEqual([BusinessConfigKey.CUSTOMER_SERVICE_WHATSAPP_NUMBER]);
      await expect(new BusinessConfigService(buildMockRepo() as any).getCustomerServiceWhatsappNumber()).rejects.toThrow();
    });
  });

  describe('checkout configuration (PD-006)', () => {
    const key = (k: string, value: unknown) => [{ id: k, key: k, value }];

    it('electronic methods: unset → all five; a list restricts it; unknown values are dropped; a non-array falls back to all', async () => {
      const all = ['INSTAPAY', 'VODAFONE_CASH', 'ORANGE_CASH', 'ETISALAT_CASH', 'WE_PAY'];
      expect(await new BusinessConfigService(buildMockRepo() as any).getEnabledElectronicPaymentMethods()).toEqual(all);
      expect(await new BusinessConfigService(buildMockRepo(key('CHECKOUT_ENABLED_ELECTRONIC_METHODS', ['WE_PAY', 'INSTAPAY', 'PAYPAL'])) as any).getEnabledElectronicPaymentMethods()).toEqual(['INSTAPAY', 'WE_PAY']);
      expect(await new BusinessConfigService(buildMockRepo(key('CHECKOUT_ENABLED_ELECTRONIC_METHODS', 'INSTAPAY')) as any).getEnabledElectronicPaymentMethods()).toEqual(all);
      expect(await new BusinessConfigService(buildMockRepo(key('CHECKOUT_ENABLED_ELECTRONIC_METHODS', [])) as any).getEnabledElectronicPaymentMethods()).toEqual([]);
    });

    it('quote TTL: default 15 minutes; a positive number is honoured (floored); anything else falls back', async () => {
      expect(await new BusinessConfigService(buildMockRepo() as any).getCheckoutQuoteTtlSeconds()).toBe(900);
      expect(await new BusinessConfigService(buildMockRepo(key('CHECKOUT_QUOTE_TTL_SECONDS', 60.9)) as any).getCheckoutQuoteTtlSeconds()).toBe(60);
      for (const bad of [0, -5, 'x', null]) expect(await new BusinessConfigService(buildMockRepo(key('CHECKOUT_QUOTE_TTL_SECONDS', bad)) as any).getCheckoutQuoteTtlSeconds()).toBe(900);
    });

    it('ETA range buffer: null (no range is invented) unless a positive number is configured', async () => {
      expect(await new BusinessConfigService(buildMockRepo() as any).getEtaRangeBufferMinutes()).toBeNull();
      expect(await new BusinessConfigService(buildMockRepo(key('ETA_RANGE_BUFFER_MINUTES', 10)) as any).getEtaRangeBufferMinutes()).toBe(10);
      for (const bad of [0, -1, 'x']) expect(await new BusinessConfigService(buildMockRepo(key('ETA_RANGE_BUFFER_MINUTES', bad)) as any).getEtaRangeBufferMinutes()).toBeNull();
    });
  });
});
