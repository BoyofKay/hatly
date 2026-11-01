import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { StaffMfaService } from './staff-mfa.service';
import { StaffMfaCredential } from './staff-mfa.entity';
import { base32Decode, hotp, timeStep } from './totp';

/**
 * MFA rollout procedure (docs/security/mfa-rollout.md): the TOTP secrets are encrypted with MFA_ENCRYPTION_KEY when it is set, else with
 * a key derived from JWT_REFRESH_SECRET — and there is NO fallback between the two. These tests pin the ordering rule the procedure
 * relies on: set the dedicated key BEFORE the first enrolment; after that, rotating JWT_REFRESH_SECRET is safe.
 */
const admin = { id: 'a0000000-0000-4000-8000-000000000001', phone: '+201000000000', role: 'SUPER_ADMIN' };

function harness(initial: Record<string, string | undefined>) {
  const values: Record<string, string | undefined> = { ...initial };
  const rows = new Map<string, StaffMfaCredential>();
  const repo = {
    findOne: async ({ where: { userId } }: { where: { userId: string } }) => rows.get(userId) ?? null,
    create: (o: Partial<StaffMfaCredential>) => ({ ...o }) as StaffMfaCredential,
    save: async (o: StaffMfaCredential) => {
      rows.set(o.userId, o);
      return o;
    },
    createQueryBuilder: () => {
      const qb = { update: () => qb, set: () => qb, where: () => qb, execute: async () => ({ affected: 1 }) };
      return qb;
    },
  };
  const config = { get: (k: string) => ({ 'auth.mfaEncryptionKey': values.MFA_ENCRYPTION_KEY, 'auth.refreshSecret': values.JWT_REFRESH_SECRET })[k] };
  const limiter = { assertAllowed: async () => undefined, recordFailure: async () => undefined, clear: async () => undefined };
  const audit = { record: async () => undefined };
  const service = new StaffMfaService(repo as never, config as unknown as ConfigService, limiter as never, audit as never);
  return { service, values };
}

async function enrol(service: StaffMfaService): Promise<Buffer> {
  return (await enrolWithRecovery(service)).raw;
}
async function enrolWithRecovery(service: StaffMfaService): Promise<{ raw: Buffer; recoveryCodes: string[] }> {
  const { secret } = await service.beginSetup(admin);
  const raw = base32Decode(secret);
  const { recoveryCodes } = await service.enable(admin, hotp(raw, timeStep(Date.now())));
  return { raw, recoveryCodes };
}
/** The fail-safe answer for an undecryptable secret: 503 MFA_UNAVAILABLE — not a 500, not a "wrong code", not a bypass. */
async function expectUnavailable(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(ServiceUnavailableException);
  expect((error as ServiceUnavailableException).getStatus()).toBe(503);
  expect((error as ServiceUnavailableException).getResponse()).toMatchObject({ details: { code: 'MFA_UNAVAILABLE' } });
}
const nextCode = (raw: Buffer) => hotp(raw, timeStep(Date.now()) + 1); // a later step than the one used to enable (replay guard)

describe('MFA rollout — encryption key ordering', () => {
  const dedicatedKey = randomBytes(32).toString('base64');

  it('RECOMMENDED: dedicated key set before enrolment → rotating JWT_REFRESH_SECRET afterwards does not affect authenticators', async () => {
    const { service, values } = harness({ MFA_ENCRYPTION_KEY: dedicatedKey, JWT_REFRESH_SECRET: 'refresh-secret-one-xxxxxxxxxxxxxxxx' });
    const raw = await enrol(service);
    values.JWT_REFRESH_SECRET = 'refresh-secret-two-yyyyyyyyyyyyyyyy';
    await expect(service.verifyLoginCode(admin, nextCode(raw))).resolves.toBeUndefined();
  });

  it('HAZARD (fails safe): no dedicated key → rotating JWT_REFRESH_SECRET makes enrolled codes unusable — 503 MFA_UNAVAILABLE, not 500', async () => {
    const { service, values } = harness({ JWT_REFRESH_SECRET: 'refresh-secret-one-xxxxxxxxxxxxxxxx' });
    const raw = await enrol(service);
    values.JWT_REFRESH_SECRET = 'refresh-secret-two-yyyyyyyyyyyyyyyy';
    await expectUnavailable(service.verifyLoginCode(admin, nextCode(raw)));
  });

  it('HAZARD (fails safe): introducing MFA_ENCRYPTION_KEY AFTER enrolment → 503 MFA_UNAVAILABLE (re-enrolment needed), not 500', async () => {
    const { service, values } = harness({ JWT_REFRESH_SECRET: 'refresh-secret-one-xxxxxxxxxxxxxxxx' });
    const raw = await enrol(service);
    values.MFA_ENCRYPTION_KEY = dedicatedKey;
    await expectUnavailable(service.verifyLoginCode(admin, nextCode(raw)));
  });

  it('after a key change a RECOVERY code still signs in (hash only, no decryption) — the documented way back in to re-enrol', async () => {
    const { service, values } = harness({ JWT_REFRESH_SECRET: 'refresh-secret-one-xxxxxxxxxxxxxxxx' });
    const { raw, recoveryCodes } = await enrolWithRecovery(service);
    values.MFA_ENCRYPTION_KEY = dedicatedKey;
    await expectUnavailable(service.verifyLoginCode(admin, nextCode(raw)));
    await expect(service.verifyLoginCode(admin, recoveryCodes[0])).resolves.toBeUndefined();
  });

  it('a wrong code under a GOOD key is still the ordinary 401 (the fail-safe never masks a wrong code)', async () => {
    const { service } = harness({ MFA_ENCRYPTION_KEY: dedicatedKey, JWT_REFRESH_SECRET: 'refresh-secret-one-xxxxxxxxxxxxxxxx' });
    const raw = await enrol(service);
    const wrong = String((Number(nextCode(raw)) + 1) % 1_000_000).padStart(6, '0');
    await expect(service.verifyLoginCode(admin, wrong)).rejects.toMatchObject({ status: 401 });
  });

  it('a malformed MFA_ENCRYPTION_KEY is refused at use (the env validator refuses it at boot too)', async () => {
    const { service } = harness({ MFA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64'), JWT_REFRESH_SECRET: 'x' });
    await expect(service.beginSetup(admin)).rejects.toThrow(/32 bytes/);
  });
});
