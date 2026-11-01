import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_primary_button.dart';
import '../auth_error_messages.dart';
import '../auth_gate.dart';
import '../otp_flow_controller.dart';
import '../widgets/auth_error_notice.dart';
import '../widgets/otp_code_field.dart';

/// Shows the destination number without exposing all of it:
/// "+201012345678" -> "+2010•••••678". Presentation only; the real number is
/// still what the flow controller holds and verifies against. The result is
/// wrapped in Unicode LTR isolates so digits keep their order inside an
/// Arabic sentence.
String maskPhoneForDisplay(String phone) {
  final masked = phone.length >= 9
      ? '${phone.substring(0, 5)}${'•' * (phone.length - 8)}${phone.substring(phone.length - 3)}'
      : phone;
  return '\u2066$masked\u2069';
}

/// The registration code step, shown while the backend has OTP enabled: the customer proves they hold the phone BEFORE the
/// account exists. Entering the right code creates the account (with the password already chosen) and signs the new customer
/// in; it never signs in an existing account. "Change phone number" (and the back button) cancels the registration — nothing
/// was created — and returns to the form.
class OtpVerifyScreen extends ConsumerStatefulWidget {
  const OtpVerifyScreen({super.key});

  @override
  ConsumerState<OtpVerifyScreen> createState() => _OtpVerifyScreenState();
}

class _OtpVerifyScreenState extends ConsumerState<OtpVerifyScreen> {
  String _currentCode = '';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final flowState = ref.watch(otpFlowControllerProvider);
    final controller = ref.read(otpFlowControllerProvider.notifier);
    leaveAuthFlowWhenSignedIn(context, ref, isMounted: () => mounted);

    // If the phone/flow state got reset (e.g. app restarted mid-flow),
    // there's nothing to verify against — send the user back rather
    // than showing a broken screen.
    if (flowState.phone == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (context.canPop()) context.pop();
      });
      return const Scaffold(body: SizedBox.shrink());
    }

    return PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) controller.skipVerification();
        },
        child: Scaffold(
          appBar: AppBar(
            backgroundColor: p.background,
            surfaceTintColor: Colors.transparent,
            leading: BackButton(onPressed: controller.skipVerification),
          ),
          body: SafeArea(
            // Scrollable so the code field and CTA stay reachable with the
            // keyboard open on small screens; the CTA still sits at the bottom
            // on tall screens.
            child: CustomScrollView(
              slivers: [
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(
                      HatlySpacing.lg,
                      HatlySpacing.sm,
                      HatlySpacing.lg,
                      HatlySpacing.lg,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(l10n.otpTitle, style: context.type.h1),
                        const SizedBox(height: HatlySpacing.sm),
                        Text(
                          l10n.otpSubtitleWithPhone(
                              maskPhoneForDisplay(flowState.phone!)),
                          style: context.type.body.copyWith(color: p.textMuted),
                        ),
                        const SizedBox(height: HatlySpacing.lg),
                        OtpCodeField(
                          hasError: flowState.errorCode != null,
                          onChanged: (value) =>
                              setState(() => _currentCode = value),
                          onCompleted: (code) =>
                              controller.confirmPhoneVerification(code),
                        ),
                        if (flowState.errorCode != null) ...[
                          const SizedBox(height: HatlySpacing.md),
                          AuthErrorNotice(
                            message: localizedErrorMessage(
                                context, flowState.errorCode),
                          ),
                        ],
                        const SizedBox(height: HatlySpacing.lg),
                        Center(
                          child: flowState.resendCooldownSeconds > 0
                              ? Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(Icons.timer_outlined,
                                        size: 18, color: p.textMuted),
                                    const SizedBox(width: HatlySpacing.xs),
                                    Flexible(
                                      child: Text(
                                        l10n.otpResendIn(
                                            flowState.resendCooldownSeconds),
                                        textAlign: TextAlign.center,
                                        style: context.type.small
                                            .copyWith(color: p.textMuted),
                                      ),
                                    ),
                                  ],
                                )
                              : TextButton.icon(
                                  onPressed: controller.resendVerification,
                                  icon: const Icon(Icons.refresh_rounded,
                                      size: 18),
                                  label: Text(
                                    l10n.otpResendAction,
                                    style: context.type.small.copyWith(
                                      color: p.link,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                        ),
                        const Spacer(),
                        const SizedBox(height: HatlySpacing.lg),
                        HatlyPrimaryButton(
                          label: l10n.otpVerifyButton,
                          isLoading: flowState.isSubmitting,
                          onPressed: _currentCode.length == 6
                              ? () => controller
                                  .confirmPhoneVerification(_currentCode)
                              : null,
                        ),
                        const SizedBox(height: HatlySpacing.sm),
                        TextButton(
                          onPressed: flowState.isSubmitting
                              ? null
                              : controller.skipVerification,
                          child: Text(l10n.otpChangeNumber),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ));
  }
}
