import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/egypt_phone_number.dart';
import '../../../../shared_widgets/hatly_button.dart';
import '../../../../shared_widgets/hatly_text_field.dart';
import '../../data/auth_providers.dart';
import '../auth_error_messages.dart';

/// Request-based "Forgot password?" (owner decision 2026-11-23). There is no SMS check, so Hatly decides: the customer sends a request,
/// Hatly calls them and gives a temporary password (60 minutes, 5 tries), and they type it here with a new password — all on this one
/// screen. "Cancel" goes back to sign-in: the old password keeps working until the change succeeds.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key, this.initialPhone = ''});
  final String initialPhone;

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

enum _Step { ask, enter, done }

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  late final _phone = TextEditingController(text: widget.initialPhone);
  final _temp = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  _Step _step = _Step.ask;
  bool _busy = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _temp.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  String? get _normalized => EgyptPhoneNumber.normalize(_phone.text);

  Future<void> _ask() async {
    final l10n = AppLocalizations.of(context);
    final phone = _normalized;
    if (phone == null) {
      setState(() => _error = l10n.phoneInvalid);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authApiProvider).requestPasswordReset(phone: phone);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _sent = true;
        _step = _Step.enter;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error =
            localizedPasswordChangeError(context, e.businessCode ?? e.code);
      });
    }
  }

  Future<void> _complete() async {
    final l10n = AppLocalizations.of(context);
    final phone = _normalized;
    String? local;
    if (phone == null) {
      local = l10n.phoneInvalid;
    } else if (_temp.text.trim().isEmpty) {
      local = l10n.forgotTempInvalid;
    } else if (_next.text.length < 8) {
      local = l10n.passwordTooShort;
    } else if (_next.text != _confirm.text) {
      local = l10n.passwordMismatch;
    }
    if (local != null) {
      setState(() => _error = local);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authApiProvider).completePasswordReset(
          phone: phone!,
          tempPassword: _temp.text.trim(),
          newPassword: _next.text);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _step = _Step.done;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      final code = e.businessCode ?? e.code;
      final left = e.details is Map ? (e.details as Map)['attemptsLeft'] : null;
      setState(() {
        _busy = false;
        switch (code) {
          case 'TEMP_PASSWORD_INVALID':
            _error =
                '${l10n.forgotTempInvalid}${left is num ? ' ${l10n.forgotTriesLeft('$left')}' : ''}';
          case 'TEMP_PASSWORD_EXPIRED':
            _error = l10n.forgotExpired;
            _step = _Step.ask;
          case 'TEMP_PASSWORD_LOCKED':
            _error = l10n.forgotLocked;
            _step = _Step.ask;
          case 'WEAK_PASSWORD':
            _error = l10n.passwordTooShort;
          case 'PASSWORD_UNCHANGED':
            _error = l10n.tempPasswordSameAsTemporary;
          default:
            _error = localizedPasswordChangeError(context, code);
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.forgotTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(HatlySpacing.screenPadding),
          children: [
            if (_step == _Step.done) ...[
              Icon(Icons.check_circle_outline, size: 48, color: p.success),
              const SizedBox(height: HatlySpacing.sm),
              Text(l10n.forgotDone,
                  key: const Key('forgot-done'),
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: HatlySpacing.lg),
              HatlyButton(
                  key: const Key('forgot-back'),
                  label: l10n.forgotBackToSignIn,
                  onPressed: () => Navigator.of(context).pop()),
            ] else ...[
              Text(_sent ? l10n.forgotSent : l10n.forgotExplain,
                  style: Theme.of(context).textTheme.bodyLarge),
              const SizedBox(height: HatlySpacing.md),
              HatlyTextField(
                  key: const Key('forgot-phone'),
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  hintText: l10n.phoneNumberLabel),
              const SizedBox(height: HatlySpacing.sm),
              if (_step == _Step.ask) ...[
                HatlyButton(
                    key: const Key('forgot-send'),
                    label: l10n.forgotSend,
                    isLoading: _busy,
                    onPressed: _ask),
                TextButton(
                    key: const Key('forgot-have-temp'),
                    onPressed: () => setState(() {
                          _error = null;
                          _step = _Step.enter;
                        }),
                    child: Text(l10n.forgotHaveTemp)),
              ] else ...[
                HatlyTextField(
                    key: const Key('forgot-temp'),
                    controller: _temp,
                     passwordVisibility: true,
                    hintText: l10n.forgotTempLabel),
                const SizedBox(height: HatlySpacing.sm),
                HatlyTextField(
                    key: const Key('forgot-new'),
                    controller: _next,
                    obscureText: true,
                     passwordVisibility: true,
                    hintText: l10n.forgotNewLabel),
                const SizedBox(height: HatlySpacing.sm),
                HatlyTextField(
                    key: const Key('forgot-confirm'),
                    controller: _confirm,
                    obscureText: true,
                     passwordVisibility: true,
                    hintText: l10n.forgotConfirmLabel),
                const SizedBox(height: HatlySpacing.sm),
                HatlyButton(
                    key: const Key('forgot-complete'),
                    label: l10n.forgotChange,
                    isLoading: _busy,
                    onPressed: _complete),
              ],
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: HatlySpacing.sm),
                  child: Text(_error!,
                      key: const Key('forgot-error'),
                      style: Theme.of(context)
                          .textTheme
                          .labelLarge
                          ?.copyWith(color: p.urgent)),
                ),
              TextButton(
                  key: const Key('forgot-cancel'),
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(l10n.forgotCancel)),
            ],
          ],
        ),
      ),
    );
  }
}
