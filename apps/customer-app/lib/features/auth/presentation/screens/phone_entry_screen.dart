import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/egypt_phone_number.dart';
import '../../../../shared_widgets/hatly_primary_button.dart';
import '../auth_error_messages.dart';
import '../auth_gate.dart';
import '../otp_flow_controller.dart';
import '../widgets/auth_error_notice.dart';
import '../widgets/egypt_phone_field.dart';
import 'forgot_password_screen.dart';
import '../../../../shared_widgets/hatly_logo.dart';

enum _EntryForm { login, register }

class PhoneEntryScreen extends ConsumerStatefulWidget {
  /// [returnTo]: where the customer was headed when sign-in was required (already sanitised by the router); the code step
  /// carries it so the redirect after a successful sign-in/registration can honour it.
  const PhoneEntryScreen({super.key, this.returnTo});

  final String? returnTo;

  @override
  ConsumerState<PhoneEntryScreen> createState() => _PhoneEntryScreenState();
}

class _PhoneEntryScreenState extends ConsumerState<PhoneEntryScreen> {
  final _phoneController = TextEditingController();
  final _nameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();

  // Local (client-side) validation error, kept separate from the
  // flow controller's server-side errorCode — they're shown the same
  // way but come from different sources and shouldn't be conflated.
  String? _localValidationError;

  /// Which form is showing: sign in (phone + password — the default, and the ONLY way to sign in) or register (full name +
  /// phone + password + confirmation; every account is created with a password). Whether a verification code follows a
  /// registration is decided by the backend afterwards; nothing here depends on the OTP setting.
  _EntryForm _form = _EntryForm.login;

  bool get _registering => _form == _EntryForm.register;

  @override
  void dispose() {
    _phoneController.dispose();
    _nameController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final flowState = ref.watch(otpFlowControllerProvider);

    leaveAuthFlowWhenSignedIn(context, ref, isMounted: () => mounted);
    ref.listen(otpFlowControllerProvider, (previous, next) {
      if (previous?.step != OtpFlowStep.otpSent &&
          next.step == OtpFlowStep.otpSent) {
        context.push(signInLocation(returnTo: widget.returnTo)
            .replaceFirst(kSignInPath, kOtpPath));
      }
    });

    final displayedError = _localValidationError ??
        (flowState.errorCode != null
            ? localizedPasswordAuthError(context, flowState.errorCode,
                registering: _registering)
            : null);

    final p = context.palette;

    return Scaffold(
      body: SafeArea(
        // Scrollable so the form stays reachable with the keyboard open on
        // small screens; on tall screens the CTA still sits at the bottom.
        child: CustomScrollView(
          slivers: [
            SliverFillRemaining(
              hasScrollBody: false,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: HatlySpacing.lg,
                  vertical: HatlySpacing.lg,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: TextButton(
                        key: const Key('browse-as-guest'),
                        onPressed: flowState.isSubmitting
                            ? null
                            : () => context.go('/'),
                        child: Text(l10n.guestBrowseAction),
                      ),
                    ),
                    const SizedBox(height: HatlySpacing.md),
                    const Center(child: HatlyLogo(size: 88)),
                    const SizedBox(height: HatlySpacing.lg),
                    Text(l10n.authWelcomeTitle, style: context.type.h1),
                    const SizedBox(height: HatlySpacing.sm),
                    Text(
                      l10n.authWelcomeSubtitle,
                      style: context.type.body.copyWith(color: p.textMuted),
                    ),
                    const SizedBox(height: HatlySpacing.xl),
                    if (_registering) ...[
                      _FieldLabel(l10n.fullNameLabel),
                      TextField(
                        controller: _nameController,
                        textInputAction: TextInputAction.next,
                        style: context.type.body.copyWith(color: p.textPrimary),
                        decoration:
                            InputDecoration(hintText: l10n.fullNameHint),
                      ),
                      const SizedBox(height: HatlySpacing.md),
                    ],
                    _FieldLabel(l10n.phoneNumberLabel),
                    EgyptPhoneField(
                        controller: _phoneController, autofocus: false),
                    const SizedBox(height: HatlySpacing.md),
                    _FieldLabel(l10n.passwordLabel),
                    TextField(
                      controller: _passwordController,
                      obscureText: true,
                      enableSuggestions: false,
                      autocorrect: false,
                      autofillHints: [
                        _form == _EntryForm.login
                            ? AutofillHints.password
                            : AutofillHints.newPassword
                      ],
                      textInputAction: _registering
                          ? TextInputAction.next
                          : TextInputAction.done,
                      onSubmitted: _registering ? null : (_) => _submit(l10n),
                      style: context.type.body.copyWith(color: p.textPrimary),
                      decoration: InputDecoration(hintText: l10n.passwordHint),
                    ),
                    if (_registering) ...[
                      const SizedBox(height: HatlySpacing.md),
                      _FieldLabel(l10n.passwordConfirmLabel),
                      TextField(
                        controller: _confirmController,
                        obscureText: true,
                        enableSuggestions: false,
                        autocorrect: false,
                        textInputAction: TextInputAction.done,
                        onSubmitted: (_) => _submit(l10n),
                        style: context.type.body.copyWith(color: p.textPrimary),
                        decoration:
                            InputDecoration(hintText: l10n.passwordHint),
                      ),
                    ],
                    const SizedBox(height: HatlySpacing.sm),
                    Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        TextButton(
                          onPressed: flowState.isSubmitting
                              ? null
                              : () => _switchTo(_form == _EntryForm.login
                                  ? _EntryForm.register
                                  : _EntryForm.login),
                          child: Text(
                            _form == _EntryForm.login
                                ? l10n.passwordCreateAccountInstead
                                : l10n.passwordHaveAccountInstead,
                          ),
                        ),
                        if (_form == _EntryForm.login)
                          TextButton(
                            key: const Key('forgot-password-link'),
                            onPressed: () => Navigator.of(context).push(
                                MaterialPageRoute<void>(
                                    builder: (_) => ForgotPasswordScreen(
                                        initialPhone: _phoneController.text))),
                            child: Text(l10n.forgotPasswordLink),
                          ),
                      ],
                    ),
                    if (displayedError != null) ...[
                      const SizedBox(height: HatlySpacing.md),
                      AuthErrorNotice(message: displayedError),
                    ],
                    const Spacer(),
                    const SizedBox(height: HatlySpacing.lg),
                    HatlyPrimaryButton(
                      label: l10n.continueButton,
                      isLoading: flowState.isSubmitting,
                      onPressed: () => _submit(l10n),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Switches form. Typed passwords are dropped (never carried between forms) and stale errors cleared; the phone is kept.
  void _switchTo(_EntryForm form) {
    ref.read(otpFlowControllerProvider.notifier).clearError();
    setState(() {
      _form = form;
      _localValidationError = null;
      _passwordController.clear();
      _confirmController.clear();
    });
  }

  /// Minimum password length, mirroring the backend's `@MinLength(8)` on registration. Sign-in only requires a value so an
  /// older, shorter password can still be used to sign in.
  static const _minPasswordLength = 8;

  void _submit(AppLocalizations l10n) {
    final fullName = _nameController.text.trim();
    final normalizedPhone = EgyptPhoneNumber.normalize(_phoneController.text);
    final password = _passwordController.text;

    final String? error;
    if (normalizedPhone == null) {
      // A number with another country's code (e.g. +966…) is not accepted — say so plainly rather than "doesn't look right".
      error = EgyptPhoneNumber.looksInternational(_phoneController.text)
          ? l10n.phoneEgyptOnly
          : l10n.phoneInvalid;
    } else if (_registering && fullName.isEmpty) {
      error = l10n.fullNameRequired;
    } else if (password.isEmpty) {
      error = l10n.passwordRequired;
    } else if (_form != _EntryForm.login &&
        password.length < _minPasswordLength) {
      error = l10n.passwordTooShort;
    } else if (_form != _EntryForm.login &&
        password != _confirmController.text) {
      error = l10n.passwordMismatch;
    } else {
      error = null;
    }
    setState(() => _localValidationError = error);
    if (error != null) return;

    final controller = ref.read(otpFlowControllerProvider.notifier);
    if (_registering) {
      controller.passwordRegister(
          normalizedPhone: normalizedPhone!,
          fullName: fullName,
          password: password);
    } else {
      controller.passwordLogin(
          normalizedPhone: normalizedPhone!, password: password);
    }
  }
}

/// Field caption: Small (14) semibold, sitting 8px above its field.
class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: HatlySpacing.sm),
      child: Text(
        text,
        style: context.type.small.copyWith(
          color: context.palette.textPrimary,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
