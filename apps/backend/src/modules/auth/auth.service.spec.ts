import { BadRequestException, ForbiddenException, GoneException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import * as jwt from 'jsonwebtoken';
import { AuthService } from './auth.service';
import { Role } from '../../common/enums/role.enum';

/** The per-account limiter is covered by login-attempt-limiter.spec.ts and its integration/e2e tests; these suites exercise token logic. */
const noopLoginLimiter = { assertAllowed: async () => undefined, recordFailure: async () => undefined, clear: async () => undefined };

function buildHarness(seed: { user?: any } = {}) {
  const usersService = {
    findByPhoneWithPasswordHash: jest.fn(async (phone: string) => {
      if (!seed.user || seed.user.phone !== phone) return null;
      return seed.user;
    }),
  };
  const otpService = {};
  const refreshTokenStore = { issue: jest.fn(async () => 'jti-123') };
  const jwtService = { sign: jest.fn(() => 'signed-token') };
  const businessConfigService = { isCustomerOtpEnabled: jest.fn(async () => true) };
  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        'auth.refreshExpiresIn': '30d',
        'auth.accessSecret': 'secret',
        'auth.accessExpiresIn': '15m',
        'auth.refreshSecret': 'refresh-secret',
      };
      return values[key];
    }),
  };

  const service = new AuthService(
    usersService as any,
    otpService as any,
    refreshTokenStore as any,
    jwtService as any,
    configService as any,
    businessConfigService as any,
    noopLoginLimiter as any,
  );
  return { service, usersService, businessConfigService };
}

describe('AuthService.loginDriverWithPassword (Phase I-A, Chunk 5 — locked decision)', () => {
  it('issues tokens for a DRIVER with the correct password', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 10);
    const { service } = buildHarness({
      user: { id: 'driver-1', phone: '+201000000001', role: Role.DRIVER, passwordHash, isActive: true },
    });

    const tokens = await service.loginDriverWithPassword('+201000000001', 'correct-password');
    expect(tokens.accessToken).toBe('signed-token');
    expect(tokens.refreshToken).toBe('signed-token');
  });

  it('rejects a nonexistent phone with a generic message', async () => {
    const { service } = buildHarness();
    await expect(service.loginDriverWithPassword('+201000000099', 'anything')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a non-DRIVER account even with a valid password hash — never a cross-role login path', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 10);
    const { service } = buildHarness({
      user: { id: 'admin-1', phone: '+201000000002', role: Role.ADMIN, passwordHash, isActive: true },
    });
    await expect(service.loginDriverWithPassword('+201000000002', 'correct-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a DRIVER account with no password set (never provisioned)', async () => {
    const { service } = buildHarness({
      user: { id: 'driver-2', phone: '+201000000003', role: Role.DRIVER, passwordHash: null, isActive: true },
    });
    await expect(service.loginDriverWithPassword('+201000000003', 'anything')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an incorrect password', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 10);
    const { service } = buildHarness({
      user: { id: 'driver-3', phone: '+201000000004', role: Role.DRIVER, passwordHash, isActive: true },
    });
    await expect(service.loginDriverWithPassword('+201000000004', 'wrong-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('AuthService.loginStaffWithPassword (Phase I-B, Chunk 9)', () => {
  async function seedWithRole(role: Role, phone: string, overrides: Partial<any> = {}) {
    const passwordHash = await bcrypt.hash('correct-password', 10);
    return { id: `${role}-1`, phone, role, passwordHash, isActive: true, ...overrides };
  }

  it('VENDOR can authenticate with the correct password', async () => {
    const user = await seedWithRole(Role.VENDOR, '+201000000010');
    const { service } = buildHarness({ user });
    const tokens = await service.loginStaffWithPassword('+201000000010', 'correct-password');
    expect(tokens.accessToken).toBe('signed-token');
  });

  it('VENDOR_MANAGER can authenticate with the correct password', async () => {
    const user = await seedWithRole(Role.VENDOR_MANAGER, '+201000000011');
    const { service } = buildHarness({ user });
    const tokens = await service.loginStaffWithPassword('+201000000011', 'correct-password');
    expect(tokens.accessToken).toBe('signed-token');
  });

  it('ADMIN can authenticate with the correct password', async () => {
    const user = await seedWithRole(Role.ADMIN, '+201000000012');
    const { service } = buildHarness({ user });
    const tokens = await service.loginStaffWithPassword('+201000000012', 'correct-password');
    expect(tokens.accessToken).toBe('signed-token');
  });

  it('SUPER_ADMIN can authenticate with the correct password', async () => {
    const user = await seedWithRole(Role.SUPER_ADMIN, '+201000000013');
    const { service } = buildHarness({ user });
    const tokens = await service.loginStaffWithPassword('+201000000013', 'correct-password');
    expect(tokens.accessToken).toBe('signed-token');
  });

  it('rejects an incorrect password for a valid staff account', async () => {
    const user = await seedWithRole(Role.VENDOR, '+201000000014');
    const { service } = buildHarness({ user });
    await expect(service.loginStaffWithPassword('+201000000014', 'wrong-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a nonexistent phone', async () => {
    const { service } = buildHarness();
    await expect(service.loginStaffWithPassword('+201000099999', 'anything')).rejects.toThrow(UnauthorizedException);
  });

  it('CUSTOMER cannot authenticate through the staff password-login endpoint, even with a valid password hash', async () => {
    const user = await seedWithRole(Role.CUSTOMER, '+201000000015');
    const { service } = buildHarness({ user });
    await expect(service.loginStaffWithPassword('+201000000015', 'correct-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('DRIVER cannot authenticate through the staff endpoint — Driver keeps its own dedicated route', async () => {
    const user = await seedWithRole(Role.DRIVER, '+201000000016');
    const { service } = buildHarness({ user });
    await expect(service.loginStaffWithPassword('+201000000016', 'correct-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('an inactive (isActive: false) staff account cannot authenticate even with the correct password', async () => {
    const user = await seedWithRole(Role.VENDOR, '+201000000017', { isActive: false });
    const { service } = buildHarness({ user });
    await expect(service.loginStaffWithPassword('+201000000017', 'correct-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('never returns passwordHash on the issued token payload', async () => {
    const user = await seedWithRole(Role.ADMIN, '+201000000018');
    const { service } = buildHarness({ user });
    const tokens = await service.loginStaffWithPassword('+201000000018', 'correct-password');
    expect(JSON.stringify(tokens)).not.toContain('passwordHash');
    expect(JSON.stringify(tokens)).not.toContain(user.passwordHash);
  });
});

describe('AuthService.loginDriverWithPassword — isActive regression (Phase I-B, Chunk 9)', () => {
  it('an inactive Driver account cannot authenticate — this check is new, previously absent', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 10);
    const { service } = buildHarness({
      user: { id: 'driver-inactive', phone: '+201000000020', role: Role.DRIVER, passwordHash, isActive: false },
    });
    await expect(service.loginDriverWithPassword('+201000000020', 'correct-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('Customer Authentication Modes (master implementation)', () => {
  function buildCustomerHarness(seed: { users?: any[]; otpEnabled?: boolean } = {}) {
    const usersByPhone = new Map<string, any>((seed.users ?? []).map((u) => [u.phone, u]));
    const usersById = new Map<string, any>((seed.users ?? []).map((u) => [u.id, u]));

    const usersService = {
      findByPhone: jest.fn(async (phone: string) => usersByPhone.get(phone) ?? null),
      findByPhoneWithPasswordHash: jest.fn(async (phone: string) => usersByPhone.get(phone) ?? null),
      findById: jest.fn(async (id: string) => usersById.get(id) ?? null),
      findByIdWithPasswordHash: jest.fn(async (id: string) => usersById.get(id) ?? null),
      createCustomer: jest.fn(async (params: { id?: string; phone: string; fullName: string; passwordHash?: string; phoneVerified?: boolean }) => {
        const user = {
          id: params.id ?? `new-${params.phone}`,
          phone: params.phone,
          fullName: params.fullName,
          passwordHash: params.passwordHash ?? null,
          role: Role.CUSTOMER,
          isActive: true,
          isPhoneVerified: params.phoneVerified === true,
        };
        usersByPhone.set(params.phone, user);
        usersById.set(user.id, user);
        return user;
      }),
      setPasswordHash: jest.fn(async (userId: string, passwordHash: string) => {
        const u = usersById.get(userId);
        if (u) u.passwordHash = passwordHash;
      }),
      markPhoneVerified: jest.fn(async (userId: string) => {
        const u = usersById.get(userId);
        if (u) u.isPhoneVerified = true;
      }),
    };

    const otpService = {
      sendOtp: jest.fn(async () => {}),
      verifyOtp: jest.fn(async () => true),
    };
    const refreshTokenStore = { issue: jest.fn(async () => 'jti-123'), revoke: jest.fn(async () => undefined) };
    const jwtService = { sign: jest.fn(() => 'signed-token') };
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          'auth.refreshExpiresIn': '30d',
          'auth.accessSecret': 'secret',
          'auth.accessExpiresIn': '15m',
          'auth.refreshSecret': 'refresh-secret',
        };
        return values[key];
      }),
    };
    const businessConfigService = {
      isCustomerOtpEnabled: jest.fn(async () => seed.otpEnabled ?? true),
    };

    const loginLimiter = { assertAllowed: jest.fn(async (_phone: string) => undefined), recordFailure: jest.fn(async (_phone: string) => undefined), clear: jest.fn(async (_phone: string) => undefined) };
    const service = new AuthService(
      usersService as any,
      otpService as any,
      refreshTokenStore as any,
      jwtService as any,
      configService as any,
      businessConfigService as any,
      loginLimiter as any,
    );
    return { service, usersService, otpService, refreshTokenStore, businessConfigService, usersByPhone, usersById, loginLimiter };
  }

  // ---- BusinessConfig ----

  describe('BusinessConfigService.isCustomerOtpEnabled (unset default)', () => {
    it('defaults to true when unset', async () => {
      const get = jest.fn(async (_key: string, defaultValue: boolean) => defaultValue);
      const svc = { get } as any;
      const { BusinessConfigService } = await import('../business-config/business-config.service');
      // Use the real class with a stubbed repo to exercise the real default path.
      const repo = { findOne: jest.fn(async () => null) };
      const real = new BusinessConfigService(repo as any);
      expect(await real.isCustomerOtpEnabled()).toBe(true);
    });

    it('returns true when explicitly set true', async () => {
      const { BusinessConfigService } = await import('../business-config/business-config.service');
      const repo = { findOne: jest.fn(async () => ({ key: 'CUSTOMER_OTP_ENABLED', value: true })) };
      const real = new BusinessConfigService(repo as any);
      expect(await real.isCustomerOtpEnabled()).toBe(true);
    });

    it('returns false when explicitly set false', async () => {
      const { BusinessConfigService } = await import('../business-config/business-config.service');
      const repo = { findOne: jest.fn(async () => ({ key: 'CUSTOMER_OTP_ENABLED', value: false })) };
      const real = new BusinessConfigService(repo as any);
      expect(await real.isCustomerOtpEnabled()).toBe(false);
    });
  });

  // ---- Retired legacy OTP registration ----

  describe('rejectLegacyOtpRegistration (POST auth/register is retired)', () => {
    it('OTP ON: refuses with 410 LEGACY_OTP_REGISTRATION_RETIRED — creates NO user, sends NO code, issues NO session', async () => {
      const { service, usersService, otpService } = buildCustomerHarness({ otpEnabled: true });
      const caught = await service.rejectLegacyOtpRegistration().catch((e) => e);
      expect(caught).toBeInstanceOf(GoneException);
      expect(caught.getResponse().details.code).toBe('LEGACY_OTP_REGISTRATION_RETIRED');
      expect(usersService.createCustomer).not.toHaveBeenCalled();
      expect(otpService.sendOtp).not.toHaveBeenCalled();
    });

    it('OTP OFF: keeps the CUSTOMER_OTP_DISABLED answer older apps use to fall back to the password form — still creates and sends nothing', async () => {
      const { service, usersService, otpService } = buildCustomerHarness({ otpEnabled: false });
      const caught = await service.rejectLegacyOtpRegistration().catch((e) => e);
      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.getResponse().details.code).toBe('CUSTOMER_OTP_DISABLED');
      expect(usersService.createCustomer).not.toHaveBeenCalled();
      expect(otpService.sendOtp).not.toHaveBeenCalled();
    });
  });

  // ---- Registration: the ONLY account-creation path, always with a password ----

  describe('requestRegistrationCode (registration step 1, OTP on)', () => {
    it('OTP ON, new phone: sends ONE code to exactly that phone', async () => {
      const { service, otpService } = buildCustomerHarness();
      await service.requestRegistrationCode('+201000000050');
      expect(otpService.sendOtp).toHaveBeenCalledTimes(1);
      expect(otpService.sendOtp).toHaveBeenCalledWith('+201000000050');
    });

    it('OTP OFF: 400 CUSTOMER_OTP_DISABLED and nothing is sent (the app then registers with a password alone)', async () => {
      const { service, otpService } = buildCustomerHarness({ otpEnabled: false });
      const caught = await service.requestRegistrationCode('+201000000050').catch((e) => e);
      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.getResponse().details.code).toBe('CUSTOMER_OTP_DISABLED');
      expect(otpService.sendOtp).not.toHaveBeenCalled();
    });

    it('a phone that ALREADY has an account: same quiet success, but NO code is sent (no enumeration, no SMS to an existing customer)', async () => {
      const { service, otpService } = buildCustomerHarness({ users: [{ id: 'e1', phone: '+201000000051', role: Role.CUSTOMER, isActive: true, passwordHash: 'h' }] });
      await expect(service.requestRegistrationCode('+201000000051')).resolves.toBeUndefined();
      expect(otpService.sendOtp).not.toHaveBeenCalled();
    });

    it('SMS provider down: the same uniform success (fail closed — OtpService stored no code); any OTHER error still surfaces', async () => {
      const { service, otpService } = buildCustomerHarness();
      otpService.sendOtp.mockRejectedValueOnce(new BadRequestException({ message: 'x', details: { code: 'SMS_PROVIDER_UNAVAILABLE' } }));
      await expect(service.requestRegistrationCode('+201000000052')).resolves.toBeUndefined();
      otpService.sendOtp.mockRejectedValueOnce(new Error('redis down'));
      await expect(service.requestRegistrationCode('+201000000052')).rejects.toThrow('redis down');
    });
  });

  describe('registerCustomerWithPassword', () => {
    it('OTP ON + a valid code: the account is created WITH a bcrypt password hash and the phone VERIFIED (decided by the server), session issued', async () => {
      const { service, usersById, usersService, otpService } = buildCustomerHarness({ otpEnabled: true });
      const tokens = await service.registerCustomerWithPassword('+201000000040', 'Sara', 'a-secure-password', '123456');
      expect(tokens.accessToken).toBe('signed-token');
      expect(otpService.verifyOtp).toHaveBeenCalledWith('+201000000040', '123456');
      const created = [...usersById.values()].find((u) => u.phone === '+201000000040');
      expect(created.isPhoneVerified).toBe(true);
      expect(created.passwordHash).toBeTruthy();
      expect(created.passwordHash).not.toBe('a-secure-password');
      expect(await bcrypt.compare('a-secure-password', created.passwordHash)).toBe(true);
      expect(usersService.createCustomer).toHaveBeenCalledWith({ id: expect.any(String), phone: '+201000000040', fullName: 'Sara', passwordHash: expect.any(String), phoneVerified: true });
    });

    it('OTP ON, no code: 400 PHONE_VERIFICATION_REQUIRED — nothing is created and no password is hashed or stored', async () => {
      const { service, usersService, otpService, refreshTokenStore } = buildCustomerHarness({ otpEnabled: true });
      for (const code of [undefined, '']) {
        const caught = await service.registerCustomerWithPassword('+201000000045', 'Sara', 'a-secure-password', code).catch((e) => e);
        expect(caught).toBeInstanceOf(BadRequestException);
        expect(caught.getResponse().details.code).toBe('PHONE_VERIFICATION_REQUIRED');
      }
      expect(otpService.verifyOtp).not.toHaveBeenCalled();
      expect(usersService.createCustomer).not.toHaveBeenCalled();
      expect(refreshTokenStore.issue).not.toHaveBeenCalled();
    });

    it('OTP ON, wrong/expired/used code: 401 and NOTHING is created or stored — and a registered phone gets the very same answer (no enumeration)', async () => {
      for (const seedUsers of [[], [{ id: 'x9', phone: '+201000000046', role: Role.CUSTOMER, isActive: true, passwordHash: 'h', isPhoneVerified: true }]]) {
        const { service, usersService, otpService, refreshTokenStore } = buildCustomerHarness({ otpEnabled: true, users: seedUsers });
        otpService.verifyOtp.mockResolvedValueOnce(false);
        const wrong = await service.registerCustomerWithPassword('+201000000046', 'Sara', 'a-secure-password', '000000').catch((e) => e);
        expect(wrong).toBeInstanceOf(UnauthorizedException);
        expect(wrong.message).toBe('Invalid or expired code.');
        otpService.verifyOtp.mockRejectedValueOnce(new UnauthorizedException('Invalid or expired code.'));
        await expect(service.registerCustomerWithPassword('+201000000046', 'Sara', 'a-secure-password', '000000')).rejects.toThrow('Invalid or expired code.');
        expect(usersService.createCustomer).not.toHaveBeenCalled();
        expect(refreshTokenStore.issue).not.toHaveBeenCalled();
      }
    });

    it('OTP OFF: no code is needed, none is verified, no SMS is sent, and the phone is created UNVERIFIED — even if the client sends a code anyway', async () => {
      for (const code of [undefined, '123456']) {
        const { service, otpService, usersById } = buildCustomerHarness({ otpEnabled: false });
        await service.registerCustomerWithPassword('+201000000042', 'Sara', 'a-secure-password', code);
        expect(otpService.verifyOtp).not.toHaveBeenCalled();
        expect(otpService.sendOtp).not.toHaveBeenCalled();
        const created = [...usersById.values()].find((u) => u.phone === '+201000000042');
        expect(created.isPhoneVerified).toBe(false); // never verified without proof
        expect(created.passwordHash).toBeTruthy();
      }
    });

    for (const [label, password] of [['missing', undefined], ['empty', ''], ['too short', 'short']] as const) {
      it(`a ${label} password is REJECTED — no account is ever created without one, and a valid code is not even consumed`, async () => {
        const { service, usersService, otpService } = buildCustomerHarness();
        const caught = await service.registerCustomerWithPassword('+201000000041', 'Sara', password as any, '123456').catch((e) => e);
        expect(caught).toBeInstanceOf(BadRequestException);
        expect(caught.getResponse().details.code).toBe('PASSWORD_REQUIRED');
        expect(otpService.verifyOtp).not.toHaveBeenCalled();
        expect(usersService.createCustomer).not.toHaveBeenCalled();
      });
    }

    for (const [label, user] of [
      ['a customer that already has a password', { isPhoneVerified: true, passwordHash: 'existing-hash', isActive: true, role: Role.CUSTOMER }],
      ['an inactive customer', { isPhoneVerified: false, passwordHash: 'existing-hash', isActive: false, role: Role.CUSTOMER }],
      ['a leftover passwordless row', { isPhoneVerified: false, passwordHash: null, isActive: true, role: Role.CUSTOMER }],
      ['a staff account', { isPhoneVerified: true, passwordHash: 'existing-hash', isActive: true, role: Role.ADMIN }],
    ] as const) {
      it(`CRITICAL: registering the phone of ${label} is refused even with a valid code — nothing is created, attached or overwritten`, async () => {
        const { service, usersById, usersService, refreshTokenStore } = buildCustomerHarness({ users: [{ id: 'x1', phone: '+201000000043', fullName: 'Original', ...user }] });
        await expect(service.registerCustomerWithPassword('+201000000043', 'Attacker Name', 'attacker-password', '123456')).rejects.toThrow(UnauthorizedException);
        expect(usersService.createCustomer).not.toHaveBeenCalled();
        expect(usersService.setPasswordHash).not.toHaveBeenCalled();
        expect(usersService.markPhoneVerified).not.toHaveBeenCalled();
        expect(refreshTokenStore.issue).not.toHaveBeenCalled();
        expect(usersById.get('x1')).toMatchObject({ fullName: 'Original', passwordHash: user.passwordHash, isPhoneVerified: user.isPhoneVerified });
      });
    }

    it('two simultaneous registrations of one phone: the unique index lets one win, the other gets the generic refusal (never a 500) and its unused session is revoked', async () => {
      const { service, usersService, refreshTokenStore } = buildCustomerHarness({ otpEnabled: false });
      usersService.createCustomer.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));
      await expect(service.registerCustomerWithPassword('+201000000044', 'Sara', 'a-secure-password')).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenStore.revoke).toHaveBeenCalledTimes(1);
    });

    describe('Redis failure: every Redis step happens BEFORE the database write, so a failure leaves nothing behind', () => {
      it('the session (jti) is stored first; the account row is written with that same id only afterwards', async () => {
        const { service, usersService, refreshTokenStore } = buildCustomerHarness({ otpEnabled: false });
        await service.registerCustomerWithPassword('+201000000047', 'Sara', 'a-secure-password');
        const [issuedFor] = refreshTokenStore.issue.mock.calls[0] as unknown as [string];
        expect(usersService.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ id: issuedFor }));
        expect(refreshTokenStore.issue.mock.invocationCallOrder[0]).toBeLessThan(usersService.createCustomer.mock.invocationCallOrder[0]);
      });

      it('Redis failing while the session is stored: the error propagates, NO account row is created, and a retry works', async () => {
        const { service, usersService, refreshTokenStore, usersByPhone } = buildCustomerHarness({ otpEnabled: false });
        refreshTokenStore.issue.mockRejectedValueOnce(new Error('Redis is down'));
        await expect(service.registerCustomerWithPassword('+201000000048', 'Sara', 'a-secure-password')).rejects.toThrow('Redis is down');
        expect(usersService.createCustomer).not.toHaveBeenCalled();
        expect(usersByPhone.has('+201000000048')).toBe(false);
        await expect(service.registerCustomerWithPassword('+201000000048', 'Sara', 'a-secure-password')).resolves.toEqual({ accessToken: 'signed-token', refreshToken: 'signed-token' });
      });

      it('Redis failing while the code is checked (OTP on): the error propagates and nothing is written', async () => {
        const { service, usersService, otpService, refreshTokenStore } = buildCustomerHarness({ otpEnabled: true });
        otpService.verifyOtp.mockRejectedValueOnce(new Error('Redis is down'));
        await expect(service.registerCustomerWithPassword('+201000000049', 'Sara', 'a-secure-password', '123456')).rejects.toThrow('Redis is down');
        expect(usersService.createCustomer).not.toHaveBeenCalled();
        expect(refreshTokenStore.issue).not.toHaveBeenCalled();
      });
    });
  });

  // ---- Password login ----

  describe('loginCustomerWithPassword', () => {
    it('a CUSTOMER with a password can log in', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      const { service } = buildCustomerHarness({
        users: [{ id: 'c6', phone: '+201000000050', role: Role.CUSTOMER, isActive: true, passwordHash, isPhoneVerified: true }],
      });
      const tokens = await service.loginCustomerWithPassword('+201000000050', 'correct-password');
      expect(tokens.accessToken).toBe('signed-token');
    });

    it('an UNVERIFIED CUSTOMER with a password can still log in — verification status never gates password login', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      const { service } = buildCustomerHarness({
        users: [{ id: 'c7', phone: '+201000000051', role: Role.CUSTOMER, isActive: true, passwordHash, isPhoneVerified: false }],
      });
      const tokens = await service.loginCustomerWithPassword('+201000000051', 'correct-password');
      expect(tokens.accessToken).toBe('signed-token');
    });

    it('an inactive Customer cannot log in', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      const { service } = buildCustomerHarness({
        users: [{ id: 'c8', phone: '+201000000052', role: Role.CUSTOMER, isActive: false, passwordHash, isPhoneVerified: true }],
      });
      await expect(service.loginCustomerWithPassword('+201000000052', 'correct-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('wrong password fails generically', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      const { service } = buildCustomerHarness({
        users: [{ id: 'c9', phone: '+201000000053', role: Role.CUSTOMER, isActive: true, passwordHash, isPhoneVerified: true }],
      });
      await expect(service.loginCustomerWithPassword('+201000000053', 'wrong-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('CRITICAL: a non-CUSTOMER role cannot authenticate via the Customer password-login path', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      const { service } = buildCustomerHarness({
        users: [{ id: 'd1', phone: '+201000000054', role: Role.DRIVER, isActive: true, passwordHash, isPhoneVerified: true }],
      });
      await expect(service.loginCustomerWithPassword('+201000000054', 'correct-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ---- Authenticated password setup ----

  describe('setCustomerPassword (authenticated CHANGE — needs the current password)', () => {
    const seedWithPassword = async () => {
      const passwordHash = await bcrypt.hash('current-password', 10);
      return { id: 'c11', phone: '+201000000061', role: Role.CUSTOMER, isActive: true, isPhoneVerified: false, passwordHash };
    };

    it('the correct current password changes it, clears the failure budget, and leaves isPhoneVerified alone', async () => {
      const { service, usersById, loginLimiter } = buildCustomerHarness({ users: [await seedWithPassword()] });
      await service.setCustomerPassword('c11', 'a-new-password', 'current-password');
      expect(await bcrypt.compare('a-new-password', usersById.get('c11').passwordHash)).toBe(true);
      expect(usersById.get('c11').isPhoneVerified).toBe(false);
      expect(loginLimiter.clear).toHaveBeenCalledWith('+201000000061');
    });

    it('CRITICAL: no current password -> 400 CURRENT_PASSWORD_REQUIRED and the password is untouched', async () => {
      const seeded = await seedWithPassword();
      const { service, usersById } = buildCustomerHarness({ users: [seeded] });
      const caught = await service.setCustomerPassword('c11', 'a-new-password').catch((e) => e);
      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.getResponse().details.code).toBe('CURRENT_PASSWORD_REQUIRED');
      expect(usersById.get('c11').passwordHash).toBe(seeded.passwordHash);
    });

    it('CRITICAL: a wrong current password -> 403 CURRENT_PASSWORD_INVALID, counted against the per-account brake, password untouched', async () => {
      const seeded = await seedWithPassword();
      const { service, usersById, loginLimiter } = buildCustomerHarness({ users: [seeded] });
      const caught = await service.setCustomerPassword('c11', 'a-new-password', 'wrong-password').catch((e) => e);
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect(caught.getResponse().details.code).toBe('CURRENT_PASSWORD_INVALID');
      expect(loginLimiter.recordFailure).toHaveBeenCalledWith('+201000000061');
      expect(usersById.get('c11').passwordHash).toBe(seeded.passwordHash);
    });

    it('the failed-attempt brake applies BEFORE the password is compared (a locked account is refused outright)', async () => {
      const seeded = await seedWithPassword();
      const { service, usersById, loginLimiter } = buildCustomerHarness({ users: [seeded] });
      loginLimiter.assertAllowed.mockRejectedValueOnce(new Error('locked'));
      await expect(service.setCustomerPassword('c11', 'a-new-password', 'current-password')).rejects.toThrow('locked');
      expect(usersById.get('c11').passwordHash).toBe(seeded.passwordHash);
    });

    it('a leftover passwordless row cannot be completed through a session — refused, nothing attached (a password is never attached by a session or a code)', async () => {
      const { service, usersById } = buildCustomerHarness({
        users: [{ id: 'c10', phone: '+201000000060', role: Role.CUSTOMER, isActive: true, isPhoneVerified: true, passwordHash: null }],
      });
      await expect(service.setCustomerPassword('c10', 'a-new-password', 'anything')).rejects.toThrow(UnauthorizedException);
      expect(usersById.get('c10').passwordHash).toBeNull();
    });

    it('rejects a nonexistent/unauthorized user id, and a non-customer', async () => {
      const { service } = buildCustomerHarness({ users: [{ id: 'a9', phone: '+201000000064', role: Role.ADMIN, isActive: true, isPhoneVerified: true, passwordHash: 'h' }] });
      await expect(service.setCustomerPassword('missing', 'a-new-password', 'x')).rejects.toThrow(UnauthorizedException);
      await expect(service.setCustomerPassword('a9', 'a-new-password', 'x')).rejects.toThrow(UnauthorizedException);
    });
  });


  // ---- OTP is not a way in: the legacy session paths no longer exist ----

  describe('OTP never signs anyone in, creates an account, or touches a password', () => {
    it('AuthService has no OTP-login, OTP-session or password-claim operation any more', () => {
      const { service } = buildCustomerHarness();
      for (const removed of ['requestLoginOtp', 'requestRegistrationOtp', 'verifyOtpAndIssueTokens', 'requestPasswordClaimCode', 'claimPasswordWithPhoneProof']) {
        expect((service as any)[removed]).toBeUndefined();
      }
    });

    it('the AUTHENTICATED phone-verification pair uses a code, but issues no tokens and writes no password', async () => {
      const { service, otpService, usersService } = buildCustomerHarness({
        users: [{ id: 'v1', phone: '+201000000101', role: Role.CUSTOMER, isActive: true, isPhoneVerified: false, passwordHash: 'h' }],
      });
      await service.requestPhoneVerificationOtp('v1');
      expect(await service.verifyPhoneOtp('v1', '123456')).toBeUndefined(); // no tokens
      expect(otpService.sendOtp).toHaveBeenCalledTimes(1);
      expect(usersService.setPasswordHash).not.toHaveBeenCalled();
      expect(usersService.createCustomer).not.toHaveBeenCalled();
    });
  });


  // ---- Authenticated post-login phone verification ----

  describe('requestPhoneVerificationOtp / verifyPhoneOtp', () => {
    it('an authenticated unverified Customer can request a verification OTP, sent to their OWN phone', async () => {
      const { service, otpService } = buildCustomerHarness({
        users: [{ id: 'c14', phone: '+201000000080', role: Role.CUSTOMER, isActive: true, isPhoneVerified: false, passwordHash: null }],
      });
      await service.requestPhoneVerificationOtp('c14');
      expect(otpService.sendOtp).toHaveBeenCalledWith('+201000000080');
    });

    it('CRITICAL: when OTP mode is OFF, the verification-request is rejected and no OTP is sent', async () => {
      const { service, otpService } = buildCustomerHarness({
        otpEnabled: false,
        users: [{ id: 'c15', phone: '+201000000081', role: Role.CUSTOMER, isActive: true, isPhoneVerified: false, passwordHash: null }],
      });
      let caught: any;
      try {
        await service.requestPhoneVerificationOtp('c15');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.getResponse().details.code).toBe('CUSTOMER_OTP_DISABLED');
      expect(otpService.sendOtp).not.toHaveBeenCalled();
    });

    it('successful confirmation sets isPhoneVerified=true', async () => {
      const { service, usersById, otpService } = buildCustomerHarness({
        users: [{ id: 'c16', phone: '+201000000082', role: Role.CUSTOMER, isActive: true, isPhoneVerified: false, passwordHash: null }],
      });
      otpService.verifyOtp.mockResolvedValueOnce(true);
      await service.verifyPhoneOtp('c16', '654321');
      expect(usersById.get('c16').isPhoneVerified).toBe(true);
    });

    it('a failed confirmation does NOT set isPhoneVerified', async () => {
      const { service, usersById, otpService } = buildCustomerHarness({
        users: [{ id: 'c17', phone: '+201000000083', role: Role.CUSTOMER, isActive: true, isPhoneVerified: false, passwordHash: null }],
      });
      otpService.verifyOtp.mockResolvedValueOnce(false);
      await expect(service.verifyPhoneOtp('c17', 'wrong')).rejects.toThrow(UnauthorizedException);
      expect(usersById.get('c17').isPhoneVerified).toBe(false);
    });

    it('CRITICAL: verification is always bound to the caller\u2019s OWN phone — no phone parameter exists to redirect it elsewhere', async () => {
      const { service, otpService } = buildCustomerHarness({
        users: [{ id: 'c18', phone: '+201000000084', role: Role.CUSTOMER, isActive: true, isPhoneVerified: false, passwordHash: null }],
      });
      await service.verifyPhoneOtp('c18', '123456');
      // verifyOtp was called with the user's OWN phone, resolved
      // server-side — never anything the caller could have supplied.
      expect(otpService.verifyOtp).toHaveBeenCalledWith('+201000000084', '123456');
    });
  });

  // ---- Transitions ----

  describe('ON/OFF transition behavior', () => {
    it('an existing password remains valid regardless of the current toggle state', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      const { service } = buildCustomerHarness({
        otpEnabled: false,
        users: [{ id: 'c19', phone: '+201000000090', role: Role.CUSTOMER, isActive: true, passwordHash, isPhoneVerified: true }],
      });
      const tokens = await service.loginCustomerWithPassword('+201000000090', 'correct-password');
      expect(tokens.accessToken).toBe('signed-token');
    });

    it('isPhoneVerified is never altered by a toggle change alone (no code path touches it outside an actual verification event)', async () => {
      const { usersById } = buildCustomerHarness({
        users: [{ id: 'c20', phone: '+201000000091', role: Role.CUSTOMER, isActive: true, isPhoneVerified: true, passwordHash: null }],
      });
      // No service call at all — asserts the seed itself is untouched,
      // i.e. nothing about constructing the harness with a different
      // otpEnabled value mutates user state.
      expect(usersById.get('c20').isPhoneVerified).toBe(true);
    });
  });

  describe('getIsPhoneVerified (backs GET auth/customer/me)', () => {
    it('returns the current isPhoneVerified value for the authenticated user', async () => {
      const { service } = buildCustomerHarness({
        users: [{ id: 'c21', phone: '+201000000092', role: Role.CUSTOMER, isActive: true, isPhoneVerified: true, passwordHash: null }],
      });
      expect(await service.getIsPhoneVerified('c21')).toBe(true);
    });

    it('rejects a nonexistent user id', async () => {
      const { service } = buildCustomerHarness();
      await expect(service.getIsPhoneVerified('missing')).rejects.toThrow(UnauthorizedException);
    });

    it.each([
      [true, false, { isPhoneVerified: false, phoneVerificationAvailable: true }],
      [false, false, { isPhoneVerified: false, phoneVerificationAvailable: false }], // OTP off never turns an unverified phone into a verified one
      [true, true, { isPhoneVerified: true, phoneVerificationAvailable: true }],
      [false, true, { isPhoneVerified: true, phoneVerificationAvailable: false }],
    ])('getPhoneVerificationStatus: OTP enabled=%s, verified=%s -> %j', async (otpEnabled, verified, expected) => {
      const { service } = buildCustomerHarness({
        otpEnabled,
        users: [{ id: 'c22', phone: '+201000000093', role: Role.CUSTOMER, isActive: true, isPhoneVerified: verified, passwordHash: 'h' }],
      });
      expect(await service.getPhoneVerificationStatus('c22')).toEqual(expected);
    });
  });
});

describe('AuthService refresh/session security (M5 Batch 1 algorithm pin + Batch 2 reuse detection)', () => {
  const REFRESH_SECRET = 'r-secret-r-secret-r-secret-r-secret-0001';
  const ACCESS_SECRET = 'a-secret-a-secret-a-secret-a-secret-0002';

  /** An in-memory model of RefreshTokenStore with the SAME rotate() contract as the Redis/Lua implementation. */
  class FakeStore {
    current = new Map<string, string>();
    used = new Map<string, string[]>();
    counter = 0;
    issue = jest.fn(async (id: string) => { const jti = `jti-${++this.counter}`; this.current.set(id, jti); return jti; });
    revoke = jest.fn(async (id: string) => { this.current.delete(id); });
    rotate = jest.fn(async (id: string, presented: string, _ttl: number, next: string | null) => {
      if (this.current.get(id) === presented) {
        this.used.set(id, [presented, ...(this.used.get(id) ?? [])].slice(0, 10));
        if (next) this.current.set(id, next); else this.current.delete(id);
        return { status: 'ROTATED' as const };
      }
      if ((this.used.get(id) ?? []).includes(presented)) { this.current.delete(id); return { status: 'REUSED' as const }; }
      return { status: 'INVALID' as const };
    });
  }

  function realTokenHarness(userOverrides: Record<string, unknown> = {}) {
    const user = { id: 'u1', phone: '+201000000001', role: Role.CUSTOMER, isActive: true, ...userOverrides };
    const store = new FakeStore();
    const configService = { get: jest.fn((k: string) => ({ 'auth.refreshExpiresIn': '30d', 'auth.accessSecret': ACCESS_SECRET, 'auth.accessExpiresIn': '15m', 'auth.refreshSecret': REFRESH_SECRET })[k]) };
    const usersService = { findById: jest.fn(async () => user) };
    const service = new AuthService(usersService as any, {} as any, store as any, new JwtService({}), configService as any, {} as any, noopLoginLimiter as any);
    return { service, store, usersService, user };
  }
  const login = (h: ReturnType<typeof realTokenHarness>) => (h.service as any).issueTokens(h.user);

  it('issues HS256 tokens; a normal refresh returns a working new pair', async () => {
    const h = realTokenHarness();
    const tokens = await login(h);
    expect(jwt.decode(tokens.accessToken, { complete: true })!.header.alg).toBe('HS256');
    expect(jwt.decode(tokens.refreshToken, { complete: true })!.header.alg).toBe('HS256');
    const next = await h.service.refresh(tokens.refreshToken);
    expect(next.accessToken).toBeTruthy();
    expect((jwt.decode(next.refreshToken) as any).jti).not.toBe((jwt.decode(tokens.refreshToken) as any).jti);
  });

  it('ROTATION: each refresh yields a new refresh token that works exactly once, and the chain keeps working', async () => {
    const h = realTokenHarness();
    let current = (await login(h)).refreshToken;
    for (let i = 0; i < 4; i++) {
      const next = await h.service.refresh(current);
      expect(next.refreshToken).not.toBe(current);
      current = next.refreshToken;
    }
  });

  it('REPLAY of an already-rotated token is refused with the generic message and revokes the session (the newest token dies too)', async () => {
    const h = realTokenHarness();
    const first = await login(h);
    const second = await h.service.refresh(first.refreshToken); // legitimate rotation
    const warn = jest.spyOn((h.service as any).logger, 'warn').mockImplementation(() => undefined);

    await expect(h.service.refresh(first.refreshToken)).rejects.toThrow('Invalid or expired refresh token.'); // replay
    expect(h.store.current.has('u1')).toBe(false); // session revoked
    await expect(h.service.refresh(second.refreshToken)).rejects.toThrow(UnauthorizedException); // legitimate holder must sign in again

    // The reuse is logged with the user id only — never the token, its jti or any claim.
    const logged = String(warn.mock.calls[0][0]);
    expect(logged).toContain('auth.refresh_token_reuse_detected');
    expect(logged).toContain('u1');
    for (const secret of [first.refreshToken, second.refreshToken, (jwt.decode(first.refreshToken) as any).jti]) expect(logged).not.toContain(secret);
  });

  it('a token that was never rotated away (forged, expired session, replaced by a newer login) is merely INVALID: nothing is revoked', async () => {
    const h = realTokenHarness();
    const old = await login(h);
    const newer = await login(h); // a second device logs in and replaces the stored jti
    await expect(h.service.refresh(old.refreshToken)).rejects.toThrow(UnauthorizedException);
    expect(h.store.current.has('u1')).toBe(true); // the newer device's session is untouched
    await expect(h.service.refresh(newer.refreshToken)).resolves.toBeDefined();
  });

  it('an unrelated user\'s session is untouched by someone else\'s reuse detection', async () => {
    const a = realTokenHarness({ id: 'ua' });
    const b = realTokenHarness({ id: 'ub' });
    b.store = a.store; // same store, two users
    (b.service as any).refreshTokenStore = a.store;
    const aTokens = await login(a);
    const bTokens = await (b.service as any).issueTokens(b.user);
    await a.service.refresh(aTokens.refreshToken);
    await expect(a.service.refresh(aTokens.refreshToken)).rejects.toThrow(UnauthorizedException); // A's reuse
    await expect(b.service.refresh(bTokens.refreshToken)).resolves.toBeDefined(); // B unaffected
  });

  it('an inactive account is refused and its session revoked', async () => {
    const h = realTokenHarness({ isActive: false });
    const tokens = await login(h);
    await expect(h.service.refresh(tokens.refreshToken)).rejects.toThrow(UnauthorizedException);
    expect(h.store.revoke).toHaveBeenCalledWith('u1');
  });

  it('a refresh token signed with another algorithm (HS512) or `none` is refused even with the right secret', async () => {
    const h = realTokenHarness();
    const hs512 = jwt.sign({ sub: 'u1', jti: 'jti-1' }, REFRESH_SECRET, { algorithm: 'HS512', expiresIn: '1d' });
    const none = jwt.sign({ sub: 'u1', jti: 'jti-1' }, '', { algorithm: 'none' } as any);
    await expect(h.service.refresh(hs512)).rejects.toThrow(UnauthorizedException);
    await expect(h.service.refresh(none)).rejects.toThrow(UnauthorizedException);
  });

  it('an ACCESS token cannot be used as a refresh token (different secret), and garbage is refused with one generic message', async () => {
    const h = realTokenHarness();
    const tokens = await login(h);
    await expect(h.service.refresh(tokens.accessToken)).rejects.toThrow('Invalid or expired refresh token.');
    await expect(h.service.refresh('not.a.jwt')).rejects.toThrow('Invalid or expired refresh token.');
  });
});
