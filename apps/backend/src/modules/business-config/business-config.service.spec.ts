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

describe('BusinessConfigService — Hatly Service delivery fee multiplier (PD-009)', () => {
  const { isValidHatlyServiceMultiplier } = jest.requireActual('./business-config.service');
  function build(stored?: unknown) {
    const rows = new Map<string, any>(stored === undefined ? [] : [['HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', { key: 'HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', value: stored }]]);
    const repo = {
      findOne: jest.fn(async ({ where }: any) => rows.get(where.key) ?? null),
      create: (d: any) => ({ ...d }),
      save: jest.fn(async (r: any) => (rows.set(r.key, r), r)),
    };
    const { BusinessConfigService } = jest.requireActual('./business-config.service');
    return { service: new BusinessConfigService(repo as any), repo };
  }

  it.each([[1.5, true], [1, true], [2.25, true], [10, true], [0, false], [-1, false], [10.5, false], ['1.5', false], [null, false], [NaN, false], [1.00001, false]])(
    'validates %p → %p',
    (value, ok) => expect(isValidHatlyServiceMultiplier(value)).toBe(ok),
  );

  it('returns the configured value (no constant in code) and fails closed when unset or invalid', async () => {
    await expect(build(1.5).service.getHatlyServiceDeliveryFeeMultiplier()).resolves.toBe(1.5);
    await expect(build().service.getHatlyServiceDeliveryFeeMultiplier()).rejects.toMatchObject({ response: { details: { code: 'BUSINESS_CONFIG_NOT_SET' } } });
    await expect(build('abc').service.getHatlyServiceDeliveryFeeMultiplier()).rejects.toMatchObject({ response: { details: { code: 'BUSINESS_CONFIG_INVALID' } } });
  });

  it('an admin write of an invalid multiplier is refused (400) and nothing is saved; a valid one is stored', async () => {
    const { service, repo } = build(1.5);
    await expect(service.set('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 0, 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'INVALID_BUSINESS_CONFIG_VALUE' } } });
    expect(repo.save).not.toHaveBeenCalled();
    await expect(service.set('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 2, 'admin-1')).resolves.toMatchObject({ value: 2 });
  });
});

describe('BusinessConfigService — customer OTP switch (temporary admin control)', () => {
  const svc = (rows: Array<{ id: string; key: string; value: unknown }> = []) => new BusinessConfigService(buildMockRepo(rows) as any);

  it('defaults to ON when never set', async () => {
    expect(await svc().isCustomerOtpEnabled()).toBe(true);
  });

  it('only an explicit boolean false turns it off; malformed legacy values stay ON (fail safe)', async () => {
    expect(await svc([{ id: 'c', key: 'CUSTOMER_OTP_ENABLED', value: false }]).isCustomerOtpEnabled()).toBe(false);
    expect(await svc([{ id: 'c', key: 'CUSTOMER_OTP_ENABLED', value: true }]).isCustomerOtpEnabled()).toBe(true);
    for (const value of [0, '', 'false', null]) {
      expect(await svc([{ id: 'c', key: 'CUSTOMER_OTP_ENABLED', value }]).isCustomerOtpEnabled()).toBe(true);
    }
  });

  it('accepts only true/false on write (persisted), refuses anything else with INVALID_BUSINESS_CONFIG_VALUE and stores nothing', async () => {
    const s = svc();
    await s.set('CUSTOMER_OTP_ENABLED', false, 'admin-1');
    expect(await s.isCustomerOtpEnabled()).toBe(false);
    await s.set('CUSTOMER_OTP_ENABLED', true, 'admin-1'); // re-enabling works
    expect(await s.isCustomerOtpEnabled()).toBe(true);
    for (const value of [0, 1, '', 'false', null, {}]) {
      await expect(s.set('CUSTOMER_OTP_ENABLED', value, 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'INVALID_BUSINESS_CONFIG_VALUE', key: 'CUSTOMER_OTP_ENABLED' } } });
    }
    expect(await s.isCustomerOtpEnabled()).toBe(true);
  });
});

describe('BusinessConfigService — Hatly / Wasally default route locations (PD-012)', () => {
  const PICKUP = BusinessConfigKey.HATLY_SERVICE_DEFAULT_PICKUP_LOCATION;
  const HATLY_END = BusinessConfigKey.HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION;
  const WASALLY_END = BusinessConfigKey.WASALLY_SERVICE_DEFAULT_DESTINATION_LOCATION;
  const good = { latitude: 30.42, longitude: 31.56, label: 'Demo point' };
  const code = (e: any) => e?.response?.details?.code;

  it.each([PICKUP, HATLY_END, WASALLY_END])('%s accepts { latitude, longitude, label } inside Egypt', async (key) => {
    const service = new BusinessConfigService(buildMockRepo() as any);
    await expect(service.set(key, good, 'admin-1')).resolves.toMatchObject({ value: good });
  });

  it.each([
    ['missing label', { latitude: 30.4, longitude: 31.5 }],
    ['blank label', { latitude: 30.4, longitude: 31.5, label: '   ' }],
    ['over-long label', { latitude: 30.4, longitude: 31.5, label: 'x'.repeat(121) }],
    ['string coordinates', { latitude: '30.4', longitude: '31.5', label: 'A' }],
    ['a point outside Egypt', { latitude: 48.8, longitude: 2.3, label: 'Paris' }],
    ['NaN', { latitude: Number.NaN, longitude: 31.5, label: 'A' }],
    ['a bare string', 'Belbeis'],
    ['a number', 7],
    ['null (clearing is DELETE, not a null value)', null],
  ])('refuses %s (INVALID_BUSINESS_CONFIG_VALUE) instead of storing it', async (_name, value) => {
    const repo = buildMockRepo();
    const service = new BusinessConfigService(repo as any);
    for (const key of [PICKUP, HATLY_END, WASALLY_END]) {
      const error = await service.set(key, value, 'admin-1').catch((e) => e);
      expect(code(error)).toBe('INVALID_BUSINESS_CONFIG_VALUE');
    }
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('getServiceRouteDefaults returns each configured default (label trimmed) and null for anything unset', async () => {
    const repo = buildMockRepo([
      { id: 'a', key: PICKUP, value: { ...good, label: '  Hatly start  ' } },
      { id: 'b', key: WASALLY_END, value: { latitude: 30.5, longitude: 31.6, label: 'Wasally end' } },
    ]);
    const defaults = await new BusinessConfigService(repo as any).getServiceRouteDefaults();
    expect(defaults).toEqual({
      hatly: { origin: { latitude: 30.42, longitude: 31.56, label: 'Hatly start' }, destination: null },
      wasally: { destination: { latitude: 30.5, longitude: 31.6, label: 'Wasally end' } },
    });
  });

  it('a stored value that is no longer valid is treated as NOT configured — never used to route a courier', async () => {
    const repo = buildMockRepo([{ id: 'a', key: HATLY_END, value: { latitude: 0, longitude: 0, label: 'Null Island' } }]);
    await expect(new BusinessConfigService(repo as any).getServiceLocation(HATLY_END)).resolves.toBeNull();
  });

  it('the three keys are separate: Hatly and Wasally never share a default', async () => {
    const repo = buildMockRepo([{ id: 'a', key: HATLY_END, value: good }]);
    const defaults = await new BusinessConfigService(repo as any).getServiceRouteDefaults();
    expect(defaults.hatly.destination).not.toBeNull();
    expect(defaults.wasally.destination).toBeNull();
  });

  it('unset clears ONLY a route default (idempotent); every other setting is refused', async () => {
    const repo: any = { ...buildMockRepo(), delete: jest.fn(async () => ({ affected: 1 })) };
    const service = new BusinessConfigService(repo);
    await expect(service.unset(PICKUP)).resolves.toEqual({ key: PICKUP, cleared: true });
    repo.delete.mockResolvedValueOnce({ affected: 0 });
    await expect(service.unset(WASALLY_END)).resolves.toEqual({ key: WASALLY_END, cleared: false });
    for (const key of ['HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 'REGISTERED_VENDOR_PRICE_PER_100M_MINOR', 'SOMETHING_ELSE']) {
      expect(code(await service.unset(key).catch((e) => e))).toBe('BUSINESS_CONFIG_NOT_CLEARABLE');
    }
    expect(repo.delete).toHaveBeenCalledTimes(2);
  });
});

describe('BusinessConfigService — R16 driver acknowledgement window', () => {
  const svc = (rows: Array<{ id: string; key: string; value: unknown }> = []) => new BusinessConfigService(buildMockRepo(rows) as any);

  it('defaults to 5 minutes when never set, and falls back to 5 for any stored value outside 1-30 whole minutes', async () => {
    expect(await svc().getAcknowledgementWindowMinutes()).toBe(5);
    for (const value of [0, 31, 2.5, '10', null, true]) {
      expect(await svc([{ id: 'w', key: 'DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES', value }]).getAcknowledgementWindowMinutes()).toBe(5);
    }
    expect(await svc([{ id: 'w', key: 'DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES', value: 12 }]).getAcknowledgementWindowMinutes()).toBe(12);
  });

  it('accepts only a whole number from 1 to 30 on write', async () => {
    const s = svc();
    await s.set('DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES', 1, 'admin-1');
    await s.set('DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES', 30, 'admin-1');
    expect(await s.getAcknowledgementWindowMinutes()).toBe(30);
    for (const value of [0, 31, 4.5, '5', null]) {
      await expect(s.set('DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES', value, 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'INVALID_BUSINESS_CONFIG_VALUE' } } });
    }
    expect(await s.getAcknowledgementWindowMinutes()).toBe(30);
  });
});
