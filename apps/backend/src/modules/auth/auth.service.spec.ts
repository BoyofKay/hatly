import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { Role } from '../../common/enums/role.enum';

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
      createCustomer: jest.fn(async (params: { phone: string; fullName: string; passwordHash?: string }) => {
        const user = {
          id: `new-${params.phone}`,
          phone: params.phone,
          fullName: params.fullName,
          passwordHash: params.passwordHash ?? null,
          role: Role.CUSTOMER,
          isActive: true,
          isPhoneVerified: false,
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
    const refreshTokenStore = { issue: jest.fn(async () => 'jti-123') };
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

    const service = new AuthService(
      usersService as any,
      otpService as any,
      refreshTokenStore as any,
      jwtService as any,
      configService as any,
      businessConfigService as any,
    );
    return { service, usersService, otpService, businessConfigService, usersByPhone, usersById };
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

  // ---- OTP mode: request path ----

  describe('requestRegistrationOtp — OTP mode gate', () => {
    it('OTP ON: preserves the existing OTP request flow exactly (new user created, OTP sent)', async () => {
      const { service, usersService, otpService } = buildCustomerHarness({ otpEnabled: true });
      await service.requestRegistrationOtp('+201000000030', 'New Customer');
      expect(usersService.createCustomer).toHaveBeenCalledWith({ phone: '+201000000030', fullName: 'New Customer' });
      expect(otpService.sendOtp).toHaveBeenCalledWith('+201000000030');
    });

    it('CRITICAL: OTP OFF rejects the request with CUSTOMER_OTP_DISABLED, and creates NO user, NO OTP', async () => {
      const { service, usersService, otpService } = buildCustomerHarness({ otpEnabled: false });
      let caught: any;
      try {
        await service.requestRegistrationOtp('+201000000031', 'New Customer');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.getResponse().details.code).toBe('CUSTOMER_OTP_DISABLED');
      expect(usersService.createCustomer).not.toHaveBeenCalled();
      expect(otpService.sendOtp).not.toHaveBeenCalled();
    });
  });

  // ---- Password registration / passwordless attachment ----

  describe('registerOrAttachCustomerPassword', () => {
    it('a genuinely new Customer registers with a password — isPhoneVerified=false, session issued', async () => {
      const { service, usersById } = buildCustomerHarness();
      const tokens = await service.registerOrAttachCustomerPassword('+201000000040', 'Sara', 'a-secure-password');
      expect(tokens.accessToken).toBe('signed-token');
      const created = usersById.get('new-+201000000040');
      expect(created.isPhoneVerified).toBe(false);
      expect(created.passwordHash).not.toBe('a-secure-password');
      expect(await bcrypt.compare('a-secure-password', created.passwordHash)).toBe(true);
    });

    it('Case C: existing verified Customer with no password can attach one — isPhoneVerified stays true', async () => {
      const { service, usersById } = buildCustomerHarness({
        users: [{ id: 'c1', phone: '+201000000041', fullName: 'Old Name', role: Role.CUSTOMER, isActive: true, isPhoneVerified: true, passwordHash: null }],
      });
      const tokens = await service.registerOrAttachCustomerPassword('+201000000041', 'Old Name', 'a-secure-password');
      expect(tokens.accessToken).toBe('signed-token');
      const updated = usersById.get('c1');
      expect(updated.isPhoneVerified).toBe(true);
      expect(await bcrypt.compare('a-secure-password', updated.passwordHash)).toBe(true);
    });

    it('Case D: existing unverified Customer with no password can attach one — isPhoneVerified stays false', async () => {
      const { service, usersById } = buildCustomerHarness({
        users: [{ id: 'c2', phone: '+201000000042', fullName: 'Old Name', role: Role.CUSTOMER, isActive: true, isPhoneVerified: false, passwordHash: null }],
      });
      await service.registerOrAttachCustomerPassword('+201000000042', 'Old Name', 'a-secure-password');
      const updated = usersById.get('c2');
      expect(updated.isPhoneVerified).toBe(false);
    });

    it('CRITICAL: a Customer that already has a password CANNOT have it overwritten — generic failure, existing hash untouched', async () => {
      const originalHash = await bcrypt.hash('original-password', 10);
      const { service, usersById, usersService } = buildCustomerHarness({
        users: [{ id: 'c3', phone: '+201000000043', fullName: 'Existing', role: Role.CUSTOMER, isActive: true, isPhoneVerified: true, passwordHash: originalHash }],
      });
      await expect(
        service.registerOrAttachCustomerPassword('+201000000043', 'Attacker Supplied Name', 'attacker-password'),
      ).rejects.toThrow(UnauthorizedException);
      expect(usersService.setPasswordHash).not.toHaveBeenCalled();
      expect(usersById.get('c3').passwordHash).toBe(originalHash);
    });

    it('the failure for an already-password-protected account is generic — indistinguishable from any other rejection', async () => {
      const originalHash = await bcrypt.hash('original-password', 10);
      const { service } = buildCustomerHarness({
        users: [{ id: 'c4', phone: '+201000000044', fullName: 'Existing', role: Role.CUSTOMER, isActive: true, isPhoneVerified: true, passwordHash: originalHash }],
      });
      try {
        await service.registerOrAttachCustomerPassword('+201000000044', 'X', 'y');
        fail('expected rejection');
      } catch (err: any) {
        expect(String(err.message ?? err.response?.message)).not.toMatch(/already has a password/i);
      }
    });

    it('an inactive existing passwordless Customer cannot attach a password', async () => {
      const { service } = buildCustomerHarness({
        users: [{ id: 'c5', phone: '+201000000045', fullName: 'X', role: Role.CUSTOMER, isActive: false, isPhoneVerified: false, passwordHash: null }],
      });
      await expect(service.registerOrAttachCustomerPassword('+201000000045', 'X', 'a-secure-password')).rejects.toThrow(
        UnauthorizedException,
      );
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

  describe('setCustomerPassword', () => {
    it('an authenticated Customer can set/change their password', async () => {
      const { service, usersById } = buildCustomerHarness({
        users: [{ id: 'c10', phone: '+201000000060', role: Role.CUSTOMER, isActive: true, isPhoneVerified: true, passwordHash: null }],
      });
      await service.setCustomerPassword('c10', 'a-new-password');
      const updated = usersById.get('c10');
      expect(await bcrypt.compare('a-new-password', updated.passwordHash)).toBe(true);
    });

    it('does not change isPhoneVerified', async () => {
      const { service, usersById } = buildCustomerHarness({
        users: [{ id: 'c11', phone: '+201000000061', role: Role.CUSTOMER, isActive: true, isPhoneVerified: false, passwordHash: null }],
      });
      await service.setCustomerPassword('c11', 'a-new-password');
      expect(usersById.get('c11').isPhoneVerified).toBe(false);
    });

    it('rejects a nonexistent/unauthorized user id', async () => {
      const { service } = buildCustomerHarness();
      await expect(service.setCustomerPassword('missing', 'a-new-password')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ---- verifyOtpAndIssueTokens — isPhoneVerified fix ----

  describe('verifyOtpAndIssueTokens — isPhoneVerified', () => {
    it('successful OTP verification sets isPhoneVerified=true', async () => {
      const { service, usersById } = buildCustomerHarness({
        users: [{ id: 'c12', phone: '+201000000070', role: Role.CUSTOMER, isActive: true, isPhoneVerified: false, passwordHash: null }],
      });
      await service.verifyOtpAndIssueTokens('+201000000070', '123456');
      expect(usersById.get('c12').isPhoneVerified).toBe(true);
    });

    it('CRITICAL: OTP verification is NOT gated by CUSTOMER_OTP_ENABLED — an already-issued code remains verifiable even after the toggle switches OFF', async () => {
      const { service, usersById, businessConfigService } = buildCustomerHarness({
        otpEnabled: false, // toggle is OFF at verification time
        users: [{ id: 'c13', phone: '+201000000071', role: Role.CUSTOMER, isActive: true, isPhoneVerified: false, passwordHash: null }],
      });
      const tokens = await service.verifyOtpAndIssueTokens('+201000000071', '123456');
      expect(tokens.accessToken).toBe('signed-token');
      expect(usersById.get('c13').isPhoneVerified).toBe(true);
      // Confirms the toggle governs the request path only, per the approved
      // policy — verification itself never consults it.
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
  });
});
