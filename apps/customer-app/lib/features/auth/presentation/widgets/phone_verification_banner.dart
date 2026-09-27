import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../data/auth_providers.dart';
import '../auth_error_messages.dart';
import '../phone_verification_prompt_controller.dart';
import 'otp_code_field.dart';

/// Customer Authentication Modes (master implementation) — Section 12.
/// Non-blocking: renders nothing (`SizedBox.shrink()`) unless the
/// backend confirms the Customer is genuinely unverified — never
/// assumed client-side. Dismissible for the current app session
/// (phoneVerificationDismissedProvider); reappears on next launch if
/// still unverified. Drop this widget into Home (or any other
/// always-visible screen) — it manages its own visibility.
class PhoneVerificationBanner extends ConsumerStatefulWidget {
  const PhoneVerificationBanner({super.key});

  @override
  ConsumerState<PhoneVerificationBanner> createState() =>
      _PhoneVerificationBannerState();
}

class _PhoneVerificationBannerState
    extends ConsumerState<PhoneVerificationBanner> {
  bool _isExpanded = false;
  bool _isRequesting = false;
  bool _isConfirming = false;
  String? _errorCode;

  Future<void> _startVerification() async {
    setState(() {
      _isRequesting = true;
      _errorCode = null;
    });
    try {
      await ref.read(authRepositoryProvider).requestPhoneVerification();
      setState(() {
        _isExpanded = true;
        _isRequesting = false;
      });
    } on ApiException catch (e) {
      setState(() {
        _isRequesting = false;
        _errorCode = e.businessCode ?? e.code;
      });
    }
  }

  Future<void> _confirm(String code) async {
    setState(() {
      _isConfirming = true;
      _errorCode = null;
    });
    try {
      await ref
          .read(authRepositoryProvider)
          .confirmPhoneVerification(code: code);
      // The status provider is the source of truth for whether this
      // banner should render at all — invalidating it makes the
      // banner disappear on the next build once it refetches `false`.
      ref.invalidate(phoneVerificationStatusProvider);
    } on ApiException catch (e) {
      setState(() {
        _isConfirming = false;
        _errorCode = e.businessCode ?? e.code;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final dismissed = ref.watch(phoneVerificationDismissedProvider);
    final statusAsync = ref.watch(phoneVerificationStatusProvider);

    if (dismissed) return const SizedBox.shrink();

    return statusAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox
          .shrink(), // non-blocking: a failed check simply doesn't show the prompt
      data: (isVerified) {
        if (isVerified) return const SizedBox.shrink();

        return Container(
          margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF4E5),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFFFE0B2)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      l10n.verifyPhonePromptTitle,
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 14),
                    ),
                  ),
                  InkWell(
                    onTap: () => ref
                        .read(phoneVerificationDismissedProvider.notifier)
                        .state = true,
                    child: const Icon(Icons.close,
                        size: 18, color: HatlyColors.textMuted),
                  ),
                ],
              ),
              if (!_isExpanded) ...[
                const SizedBox(height: 4),
                Text(l10n.verifyPhonePromptSubtitle,
                    style: const TextStyle(
                        fontSize: 12, color: HatlyColors.textMuted)),
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    onPressed: _isRequesting ? null : _startVerification,
                    child: Text(
                        _isRequesting ? '...' : l10n.verifyPhonePromptAction),
                  ),
                ),
              ] else ...[
                const SizedBox(height: 10),
                OtpCodeField(
                  autofocus: false,
                  onChanged: (_) {},
                  onCompleted: _isConfirming ? (_) {} : _confirm,
                ),
              ],
              if (_errorCode != null) ...[
                const SizedBox(height: 6),
                Text(
                  localizedErrorMessage(context, _errorCode),
                  style: const TextStyle(fontSize: 12, color: Colors.red),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}
