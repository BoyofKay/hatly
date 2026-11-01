import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { OtpService } from './otp.service';

// OtpService now receives its Redis client via constructor injection
// (Group 1 — Redis reliability hardening) rather than constructing one
// internally, so no `jest.mock('ioredis')` module-level mocking is
// needed here anymore — the fake instance below is passed directly.

function buildHarness(opts: { smsSucceeds?: boolean; logCodeForLocalDev?: boolean } = {}) {
  const redisStore = new Map<string, string>();
  const mockRedisInstance = {
    get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      redisStore.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      redisStore.delete(key);
      return 1;
    }),
  };

  const configValues: Record<string, any> = {
    'redis.url': 'redis://localhost:6379',
    'otp.ttlSeconds': 300,
    'otp.maxAttempts': 5,
    'otp.resendCooldownSeconds': 60,
    'otp.logCodeForLocalDev': opts.logCodeForLocalDev ?? false,
    env: 'test',
  };
  const configService = { get: jest.fn((key: string) => configValues[key]) };

  const smsProvider = {
    sendSms: jest.fn(async (_params: { to: string; body: string }) => ({
      success: opts.smsSucceeds ?? true,
      providerMessageId: 'msg-1',
    })),
  };

  const service = new OtpService(configService as any, smsProvider as any, mockRedisInstance as any);
  return { service, smsProvider, redisStore, mockRedisInstance };
}

describe('OtpService — Unifonic SMS provider integration', () => {
  it('OTP ON: sendOtp calls SmsProvider with the generated code embedded in the message body', async () => {
    const { service, smsProvider } = buildHarness();
    await service.sendOtp('+201000000010');
    expect(smsProvider.sendSms).toHaveBeenCalledTimes(1);
    const call = smsProvider.sendSms.mock.calls[0][0];
    expect(call.to).toBe('+201000000010');
    expect(call.body).toMatch(/Hatly verification code: \d{6}/);
  });

  it('a successful provider acceptance leaves a usable OTP and cooldown key in Redis', async () => {
    const { service, redisStore } = buildHarness();
    await service.sendOtp('+201000000011');
    expect(redisStore.has('otp:+201000000011')).toBe(true);
    expect(redisStore.has('otp-cooldown:+201000000011')).toBe(true);
  });

  it('CRITICAL: provider failure throws a controlled SMS_PROVIDER_UNAVAILABLE error', async () => {
    const { service } = buildHarness({ smsSucceeds: false });
    let caught: any;
    try {
      await service.sendOtp('+201000000012');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught.getResponse().details.code).toBe('SMS_PROVIDER_UNAVAILABLE');
  });

  it('CRITICAL: provider failure leaves NO usable OTP in Redis — fail-closed, no orphaned code', async () => {
    const { service, redisStore } = buildHarness({ smsSucceeds: false });
    await expect(service.sendOtp('+201000000013')).rejects.toThrow(BadRequestException);
    expect(redisStore.has('otp:+201000000013')).toBe(false);
  });

  it('CRITICAL: provider failure does NOT consume the resend cooldown — a transient failure must not block retrying', async () => {
    const { service, redisStore } = buildHarness({ smsSucceeds: false });
    await expect(service.sendOtp('+201000000014')).rejects.toThrow(BadRequestException);
    expect(redisStore.has('otp-cooldown:+201000000014')).toBe(false);
  });

  it('the existing resend-cooldown early-return still applies BEFORE any provider call', async () => {
    const { service, smsProvider, redisStore } = buildHarness();
    redisStore.set('otp-cooldown:+201000000015', '1');
    await service.sendOtp('+201000000015');
    expect(smsProvider.sendSms).not.toHaveBeenCalled();
  });

  it('existing verification behavior is unchanged: correct code succeeds and deletes the OTP', async () => {
    const { service, redisStore } = buildHarness();
    const crypto = require('crypto');
    const knownCode = '123456';
    redisStore.set(
      'otp:+201000000016',
      JSON.stringify({ codeHash: crypto.createHash('sha256').update(knownCode).digest('hex'), attempts: 0 }),
    );
    const isValid = await service.verifyOtp('+201000000016', knownCode);
    expect(isValid).toBe(true);
    expect(redisStore.has('otp:+201000000016')).toBe(false);
  });

  it('existing max-attempts behavior is unchanged', async () => {
    const { service, redisStore } = buildHarness();
    const crypto = require('crypto');
    redisStore.set(
      'otp:+201000000017',
      JSON.stringify({ codeHash: crypto.createHash('sha256').update('999999').digest('hex'), attempts: 5 }),
    );
    await expect(service.verifyOtp('+201000000017', '999999')).rejects.toThrow(UnauthorizedException);
    expect(redisStore.has('otp:+201000000017')).toBe(false);
  });

  it('existing expired/nonexistent-OTP behavior is unchanged', async () => {
    const { service } = buildHarness();
    await expect(service.verifyOtp('+201000000018', '000000')).rejects.toThrow(UnauthorizedException);
  });

  it('logCodeForLocalDev remains independent of SMS provider success — still calls the provider when enabled, not a substitute for delivery', async () => {
    const { service, smsProvider } = buildHarness({ smsSucceeds: true, logCodeForLocalDev: true });
    await service.sendOtp('+201000000019');
    expect(smsProvider.sendSms).toHaveBeenCalled();
  });

  it('SINGLE USE under concurrency: when another request already consumed the code, a second verification of the same correct code is refused', async () => {
    const { service, redisStore, mockRedisInstance } = buildHarness();
    const crypto = require('crypto');
    redisStore.set('otp:+201000000020', JSON.stringify({ codeHash: crypto.createHash('sha256').update('424242').digest('hex'), attempts: 0 }));
    // Both racers passed the hash comparison; Redis reports the key already deleted for the loser (DEL returned 0).
    mockRedisInstance.del.mockImplementationOnce(async () => 0);
    expect(await service.verifyOtp('+201000000020', '424242')).toBe(false);
  });
});
