import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/auth/presentation/otp_flow_controller.dart';
import 'package:hatly_customer/features/auth/presentation/session_controller.dart';

import '../../support/auth_fakes.dart';

/// The customer authentication flow against a scripted backend (real repository, real flow + session controllers).
///
/// Product rules under test:
///  - sign-in is phone + password and NEVER requests an OTP, whatever `CUSTOMER_OTP_ENABLED` is;
///  - OTP only verifies a phone during registration, and only while the backend says OTP is enabled;
///  - with OTP disabled a customer can still register and sign in, and is never marked verified;
///  - the backend, not the app, decides the mode — toggling it mid-flow never strands the customer.
void main() {
  late FakeAuthApi api;
  late FakeAuthTokenStorage storage;
  late ProviderContainer container;

  setUp(() async {
    api = FakeAuthApi();
    storage = FakeAuthTokenStorage();
    container = ProviderContainer(overrides: authOverrides(api, storage));
    addTearDown(container.dispose);
    // Let the session controller finish restoring (no persisted session → unauthenticated).
    container.read(sessionControllerProvider);
    await Future<void>.delayed(Duration.zero);
    container.listen(otpFlowControllerProvider,
        (_, __) {}); // keep the autoDispose controller alive
  });

  OtpFlowController flow() =>
      container.read(otpFlowControllerProvider.notifier);
  OtpFlowState flowState() => container.read(otpFlowControllerProvider);
  SessionStatus session() => container.read(sessionControllerProvider).status;
  const phone = '+201012345678';

  group('sign-in (phone + password)', () {
    for (final otpEnabled in [true, false]) {
      test(
          'never requests an OTP or any verification call — OTP setting ${otpEnabled ? 'ON' : 'OFF'}',
          () async {
        api.otpEnabled = otpEnabled;
        final ok = await flow()
            .passwordLogin(normalizedPhone: phone, password: 'secret-pass');

        expect(ok, isTrue);
        expect(api.calls, ['passwordLogin'],
            reason:
                'ordinary login must not touch register/OTP/verification endpoints');
        expect(session(), SessionStatus.authenticated);
        expect(storage.access, 'access-token');
        expect(flowState().step, OtpFlowStep.enteringPhone);
      });
    }

    test(
        'an UNVERIFIED account signs in without any verification step (the Home banner handles that later)',
        () async {
      api.phoneVerified = false;
      await flow()
          .passwordLogin(normalizedPhone: phone, password: 'secret-pass');
      expect(api.calls, ['passwordLogin']);
      expect(session(), SessionStatus.authenticated);
    });

    test(
        'wrong credentials: error surfaced, session stays signed out, nothing else called',
        () async {
      api.loginError = apiError('UNAUTHORIZED', status: 401);
      final ok = await flow()
          .passwordLogin(normalizedPhone: phone, password: 'nope-nope');

      expect(ok, isFalse);
      expect(flowState().errorCode, 'UNAUTHORIZED');
      expect(flowState().isSubmitting, isFalse);
      expect(session(), SessionStatus.unauthenticated);
      expect(storage.access, isNull);
      expect(api.calls, ['passwordLogin']);
    });

    test(
        'the per-account lockout surfaces its own code, and the form is usable again afterwards',
        () async {
      api.loginError = apiError('TOO_MANY_REQUESTS',
          businessCode: 'TOO_MANY_FAILED_LOGINS', status: 429);
      await flow().passwordLogin(normalizedPhone: phone, password: 'nope-nope');
      expect(flowState().errorCode, 'TOO_MANY_FAILED_LOGINS');
      expect(flowState().isSubmitting, isFalse);

      api.loginError = null;
      expect(
          await flow()
              .passwordLogin(normalizedPhone: phone, password: 'secret-pass'),
          isTrue);
      expect(flowState().errorCode, isNull,
          reason: 'a new attempt clears the old error');
    });

    test('a network failure is reported and leaves the form usable', () async {
      api.loginError = apiError('NETWORK_ERROR');
      expect(
          await flow()
              .passwordLogin(normalizedPhone: phone, password: 'secret-pass'),
          isFalse);
      expect(flowState().errorCode, 'NETWORK_ERROR');
      expect(flowState().isSubmitting, isFalse);
    });

    test(
        'a second submit while one is in flight is ignored (no duplicate request)',
        () async {
      final first =
          flow().passwordLogin(normalizedPhone: phone, password: 'secret-pass');
      final second = await flow()
          .passwordLogin(normalizedPhone: phone, password: 'secret-pass');
      await first;
      expect(second, isFalse);
      expect(api.calls, ['passwordLogin']);
    });
  });

  Future<bool> register({String name = 'Test Customer'}) =>
      flow().passwordRegister(
          normalizedPhone: phone, fullName: name, password: 'secret-pass');

  group(
      'registration — OTP enabled: the phone is proven BEFORE the account exists',
      () {
    test(
        'asks for a code and waits: NO account is created and nobody is signed in until the right code is entered',
        () async {
      expect(await register(), isTrue);

      expect(api.calls, ['requestRegistrationCode']);
      expect(api.registeredAccounts, isEmpty);
      expect(flowState().step, OtpFlowStep.otpSent);
      expect(flowState().phone, phone);
      expect(flowState().resendCooldownSeconds, greaterThan(0));
      expect(session(), SessionStatus.unauthenticated);
      expect(storage.access, isNull);
    });

    test(
        'the right code creates the account WITH its password, signs the customer in, and the backend (not the app) marks the phone verified',
        () async {
      await register(name: 'Sara');
      expect(await flow().confirmPhoneVerification('123456'), isTrue);

      expect(api.calls, ['requestRegistrationCode', 'passwordRegister:123456']);
      expect(api.registeredAccounts.single,
          (phone: phone, fullName: 'Sara', passwordGiven: true));
      expect(api.phoneVerified, isTrue);
      expect(session(), SessionStatus.authenticated);
      expect(storage.name, 'Sara');
      // the app never calls the post-registration verification endpoints any more: the account is already verified
      expect(api.calls, isNot(contains('requestPhoneVerification')));
      expect(api.calls, isNot(contains('getPhoneVerificationStatus')));
    });

    test(
        'a wrong or expired code keeps the customer on the code screen with an error; still no account; the right code then works',
        () async {
      await register();
      expect(await flow().confirmPhoneVerification('000000'), isFalse);
      expect(flowState().errorCode, 'UNAUTHORIZED');
      expect(flowState().step, OtpFlowStep.otpSent);
      expect(api.registeredAccounts, isEmpty);
      expect(session(), SessionStatus.unauthenticated);

      expect(await flow().confirmPhoneVerification('123456'), isTrue);
      expect(api.registeredAccounts, hasLength(1));
      expect(session(), SessionStatus.authenticated);
    });

    test(
        'leaving the code screen CANCELS the registration: back to the form, nothing created, the typed password is forgotten',
        () async {
      await register();
      flow().skipVerification();

      expect(flowState().step, OtpFlowStep.enteringPhone);
      expect(session(), SessionStatus.unauthenticated);
      expect(api.registeredAccounts, isEmpty);
      // with the password forgotten, a stray confirm cannot create anything
      expect(await flow().confirmPhoneVerification('123456'), isFalse);
      expect(api.registeredAccounts, isEmpty);
      expect(api.calls, ['requestRegistrationCode']);
    });

    test('resend is blocked during the cooldown (no extra request)', () async {
      await register();
      final before = api.calls.length;
      await flow().resendVerification();
      expect(api.calls.length, before);
    });

    test(
        'after the cooldown, resend asks for a new code (still nothing created)',
        () async {
      await register();
      container.read(otpFlowControllerProvider.notifier).state =
          flowState().copyWith(resendCooldownSeconds: 0);
      await flow().resendVerification();
      expect(api.calls, ['requestRegistrationCode', 'requestRegistrationCode']);
      expect(flowState().resendCooldownSeconds, greaterThan(0));
      expect(api.registeredAccounts, isEmpty);
    });

    test(
        'defence in depth: a register call WITHOUT a code while OTP is on is refused by the backend (PHONE_VERIFICATION_REQUIRED) and creates nothing',
        () async {
      await expectLater(
          api.passwordRegister(
              phone: phone, fullName: 'X Y', password: 'secret-pass'),
          throwsA(isA<ApiException>().having((e) => e.businessCode,
              'businessCode', 'PHONE_VERIFICATION_REQUIRED')));
      expect(api.registeredAccounts, isEmpty);
    });

    test(
        'a phone that already has an account is indistinguishable until the last step: the code request succeeds, the final registration is refused and nothing changes',
        () async {
      await register();
      api.registerError = apiError('UNAUTHORIZED', status: 401);
      expect(await flow().confirmPhoneVerification('123456'), isFalse);
      expect(flowState().errorCode, 'UNAUTHORIZED');
      expect(api.registeredAccounts, isEmpty);
      expect(session(), SessionStatus.unauthenticated);
      expect(storage.access, isNull);
    });

    test(
        'an SMS outage on the code request is reported on the form (nothing was created)',
        () async {
      api.registrationCodeError = apiError('BAD_REQUEST',
          businessCode: 'SMS_PROVIDER_UNAVAILABLE', status: 400);
      expect(await register(), isFalse);
      expect(flowState().errorCode, 'SMS_PROVIDER_UNAVAILABLE');
      expect(flowState().step, OtpFlowStep.enteringPhone);
      expect(api.registeredAccounts, isEmpty);
    });

    test(
        'a rate-limited final step (429) keeps the pending registration: the error shows on the code screen, no account exists, and a retry with the right code works',
        () async {
      await register();
      api.registerError = apiError('TOO_MANY_REQUESTS', status: 429);
      expect(await flow().confirmPhoneVerification('123456'), isFalse);
      expect(flowState().errorCode, 'TOO_MANY_REQUESTS');
      expect(flowState().step, OtpFlowStep.otpSent);
      expect(api.registeredAccounts, isEmpty);

      api.registerError = null;
      expect(await flow().confirmPhoneVerification('123456'), isTrue);
      expect(api.registeredAccounts, hasLength(1));
      expect(session(), SessionStatus.authenticated);
    });

    test(
        'a failed resend (rate limit) shows its error on the code screen and keeps the registration; nothing is created',
        () async {
      await register();
      container.read(otpFlowControllerProvider.notifier).state =
          flowState().copyWith(resendCooldownSeconds: 0);
      api.registrationCodeError = apiError('TOO_MANY_REQUESTS', status: 429);
      await flow().resendVerification();
      expect(flowState().errorCode, 'TOO_MANY_REQUESTS');
      expect(flowState().step, OtpFlowStep.otpSent);
      expect(flowState().isSubmitting, isFalse);
      expect(api.registeredAccounts, isEmpty);
      expect(session(), SessionStatus.unauthenticated);
    });

    test(
        'a network failure on the final step keeps the pending registration so the customer can retry',
        () async {
      await register();
      api.registerError = apiError('NETWORK_ERROR');
      expect(await flow().confirmPhoneVerification('123456'), isFalse);
      expect(flowState().step, OtpFlowStep.otpSent);
      api.registerError = null;
      expect(await flow().confirmPhoneVerification('123456'), isTrue);
    });

    test('a rate-limited code request surfaces its error and stays on the form',
        () async {
      api.registrationCodeError = apiError('TOO_MANY_REQUESTS', status: 429);
      expect(await register(), isFalse);
      expect(flowState().errorCode, 'TOO_MANY_REQUESTS');
      expect(flowState().step, OtpFlowStep.enteringPhone);
    });
  });

  group('registration — OTP disabled: no SMS, no fabricated verification', () {
    setUp(() => api.otpEnabled = false);

    test(
        'registers with the password alone and enters the app; the phone is NOT marked verified and no code step is shown',
        () async {
      expect(await register(), isTrue);

      expect(api.calls, ['requestRegistrationCode', 'passwordRegister']);
      expect(api.registeredAccounts.single.passwordGiven, isTrue);
      expect(flowState().step, OtpFlowStep.enteringPhone);
      expect(flowState().errorCode, isNull,
          reason: 'a disabled OTP is not an error the customer must see');
      expect(api.phoneVerified, isFalse, reason: 'never falsely verified');
      expect(session(), SessionStatus.authenticated);
    });

    test(
        'registration refused (e.g. the phone already has an account): error shown, signed out',
        () async {
      api.registerError = apiError('UNAUTHORIZED', status: 401);
      expect(await register(), isFalse);
      expect(flowState().errorCode, 'UNAUTHORIZED');
      expect(api.calls, ['requestRegistrationCode', 'passwordRegister']);
      expect(session(), SessionStatus.unauthenticated);
      expect(storage.access, isNull);
    });

    test('sign-in works exactly the same', () async {
      expect(
          await flow()
              .passwordLogin(normalizedPhone: phone, password: 'secret-pass'),
          isTrue);
      expect(api.calls, ['passwordLogin']);
      expect(session(), SessionStatus.authenticated);
    });
  });

  group('the Admin toggles CUSTOMER_OTP_ENABLED', () {
    test(
        'OFF → ON between two registrations: the second one needs a code; nothing was cached',
        () async {
      api.otpEnabled = false;
      await flow().passwordRegister(
          normalizedPhone: phone, fullName: 'First', password: 'secret-pass');
      expect(flowState().step, OtpFlowStep.enteringPhone);
      expect(api.registeredAccounts, hasLength(1));

      api.otpEnabled = true;
      api.calls.clear();
      container.read(sessionControllerProvider.notifier).state =
          const SessionState(SessionStatus.unauthenticated);
      await flow().passwordRegister(
          normalizedPhone: '+201012345679',
          fullName: 'Second',
          password: 'secret-pass');
      expect(api.calls, ['requestRegistrationCode']);
      expect(flowState().step, OtpFlowStep.otpSent);
      expect(api.registeredAccounts, hasLength(1));
    });

    test(
        'ON → OFF while the code screen is showing: "resend" finds OTP disabled and completes the registration without a code (not stuck; phone unverified)',
        () async {
      await register();
      expect(flowState().step, OtpFlowStep.otpSent);
      expect(session(), SessionStatus.unauthenticated);

      api.otpEnabled = false;
      container.read(otpFlowControllerProvider.notifier).state =
          flowState().copyWith(resendCooldownSeconds: 0);
      await flow().resendVerification();

      expect(session(), SessionStatus.authenticated);
      expect(api.registeredAccounts, hasLength(1));
      expect(flowState().errorCode, isNull);
      expect(api.phoneVerified, isFalse);
    });

    test(
        'an existing password account signs in identically before and after the toggle',
        () async {
      for (final enabled in [false, true, false]) {
        api.otpEnabled = enabled;
        api.calls.clear();
        expect(
            await flow()
                .passwordLogin(normalizedPhone: phone, password: 'secret-pass'),
            isTrue);
        expect(api.calls, ['passwordLogin']);
      }
    });
  });

  group('registration can never take over an existing account', () {
    test(
        'a refused registration (the phone already has an account) is just an error: no password is attached, nobody is signed in',
        () async {
      api.otpEnabled = false;
      api.registerError = apiError('UNAUTHORIZED', status: 401);
      expect(await register(), isFalse);
      expect(api.calls, ['requestRegistrationCode', 'passwordRegister']);
      expect(api.registeredAccounts, isEmpty);
      expect(flowState().errorCode, 'UNAUTHORIZED');
      expect(flowState().step, OtpFlowStep.enteringPhone);
      expect(session(), SessionStatus.unauthenticated);
    });
  });
}
