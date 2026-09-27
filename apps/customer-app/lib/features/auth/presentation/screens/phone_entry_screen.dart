import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/egypt_phone_number.dart';
import '../../../../shared_widgets/hatly_primary_button.dart';
import '../auth_error_messages.dart';
import '../otp_flow_controller.dart';
import '../widgets/auth_error_notice.dart';
import '../widgets/egypt_phone_field.dart';

class PhoneEntryScreen extends ConsumerStatefulWidget {
  const PhoneEntryScreen({super.key});

  @override
  ConsumerState<PhoneEntryScreen> createState() => _PhoneEntryScreenState();
}

class _PhoneEntryScreenState extends ConsumerState<PhoneEntryScreen> {
  final _phoneController = TextEditingController();
  final _nameController = TextEditingController();
  final _passwordController = TextEditingController();

  // Local (client-side) validation error, kept separate from the
  // flow controller's server-side errorCode — they're shown the same
  // way but come from different sources and shouldn't be conflated.
  String? _localValidationError;

  /// Customer Authentication Modes (master implementation). Only
  /// meaningful once `flowState.mode == AuthMode.password` — toggles
  /// between the register/attach sub-form (phone+fullName+password,
  /// the default) and the plain login sub-form (phone+password only),
  /// both on this same screen, no new route.
  bool _isLoginSubForm = false;

  @override
  void dispose() {
    _phoneController.dispose();
    _nameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final flowState = ref.watch(otpFlowControllerProvider);
    final isPasswordMode = flowState.mode == AuthMode.password;

    ref.listen(otpFlowControllerProvider, (previous, next) {
      if (previous?.step != OtpFlowStep.otpSent &&
          next.step == OtpFlowStep.otpSent) {
        context.push('/otp');
      }
    });

    final displayedError = _localValidationError ??
        (flowState.errorCode != null
            ? localizedErrorMessage(context, flowState.errorCode)
            : null);

    final p = context.palette;
    final isLoginForm = isPasswordMode && _isLoginSubForm;

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
                    const SizedBox(height: HatlySpacing.xl),
                    Text(l10n.authWelcomeTitle, style: context.type.h1),
                    const SizedBox(height: HatlySpacing.sm),
                    Text(
                      l10n.authWelcomeSubtitle,
                      style: context.type.body.copyWith(color: p.textMuted),
                    ),
                    const SizedBox(height: HatlySpacing.xl),
                    if (!isLoginForm) ...[
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
                    if (isPasswordMode) ...[
                      const SizedBox(height: HatlySpacing.md),
                      _FieldLabel(l10n.passwordLabel),
                      TextField(
                        controller: _passwordController,
                        obscureText: true,
                        textInputAction: TextInputAction.done,
                        style: context.type.body.copyWith(color: p.textPrimary),
                        decoration:
                            InputDecoration(hintText: l10n.passwordHint),
                      ),
                      const SizedBox(height: HatlySpacing.sm),
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: TextButton(
                          onPressed: () => setState(
                              () => _isLoginSubForm = !_isLoginSubForm),
                          child: Text(
                            _isLoginSubForm
                                ? l10n.passwordCreateAccountInstead
                                : l10n.passwordHaveAccountInstead,
                          ),
                        ),
                      ),
                    ],
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

  void _submit(AppLocalizations l10n) {
    final isPasswordMode =
        ref.read(otpFlowControllerProvider).mode == AuthMode.password;
    final fullName = _nameController.text.trim();
    final normalizedPhone = EgyptPhoneNumber.normalize(_phoneController.text);
    final password = _passwordController.text;

    setState(() {
      if (normalizedPhone == null) {
        _localValidationError = l10n.phoneInvalid;
      } else if (!(isPasswordMode && _isLoginSubForm) && fullName.isEmpty) {
        _localValidationError = l10n.fullNameRequired;
      } else if (isPasswordMode && password.isEmpty) {
        _localValidationError = l10n.passwordRequired;
      } else {
        _localValidationError = null;
      }
    });

    if (_localValidationError != null) return;

    if (!isPasswordMode) {
      ref
          .read(otpFlowControllerProvider.notifier)
          .requestOtp(normalizedPhone: normalizedPhone!, fullName: fullName);
      return;
    }

    if (_isLoginSubForm) {
      ref
          .read(otpFlowControllerProvider.notifier)
          .passwordLogin(normalizedPhone: normalizedPhone!, password: password);
    } else {
      ref.read(otpFlowControllerProvider.notifier).passwordRegister(
          normalizedPhone: normalizedPhone!,
          fullName: fullName,
          password: password);
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
