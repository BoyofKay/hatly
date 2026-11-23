import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_button.dart';
import '../../../../shared_widgets/hatly_text_field.dart';
import '../../data/auth_providers.dart';
import '../auth_error_messages.dart';
import '../session_controller.dart';

/// Owner decision 2026-11-23: after signing in with a TEMPORARY password (set by Hatly operations from the admin panel) the customer
/// must choose their own before using the app. The server refuses everything else meanwhile (PASSWORD_CHANGE_REQUIRED); the router
/// shows only this screen while `SessionState.mustChangePassword` is true.
class ForcedPasswordChangeScreen extends ConsumerStatefulWidget {
  const ForcedPasswordChangeScreen({super.key});

  @override
  ConsumerState<ForcedPasswordChangeScreen> createState() =>
      _ForcedPasswordChangeScreenState();
}

class _ForcedPasswordChangeScreenState
    extends ConsumerState<ForcedPasswordChangeScreen> {
  static const _minPasswordLength = 8;
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving) return;
    final l10n = AppLocalizations.of(context);
    String? local;
    if (_current.text.isEmpty) {
      local = l10n.errorCurrentPasswordRequired;
    } else if (_next.text.length < _minPasswordLength) {
      local = l10n.passwordTooShort;
    } else if (_next.text != _confirm.text) {
      local = l10n.tempPasswordMismatch;
    } else if (_next.text == _current.text) {
      local = l10n.tempPasswordSameAsTemporary;
    }
    if (local != null) {
      setState(() => _error = local);
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(authRepositoryProvider)
          .setPassword(password: _next.text, currentPassword: _current.text);
      if (!mounted) return;
      setState(() => _saving = false);
      ref.read(sessionControllerProvider.notifier).passwordChanged();
    } on ApiException catch (e) {
      if (!mounted) return;
      final code = e.businessCode ?? e.code;
      setState(() {
        _saving = false;
        _error = code == 'PASSWORD_UNCHANGED'
            ? l10n.tempPasswordSameAsTemporary
            : localizedPasswordChangeError(context, code);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: false,
          title: Text(l10n.tempPasswordTitle),
          actions: [
            TextButton(
              key: const Key('temp-password-sign-out'),
              onPressed: () =>
                  ref.read(sessionControllerProvider.notifier).logout(),
              child: Text(l10n.tempPasswordSignOut),
            ),
          ],
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(HatlySpacing.screenPadding),
            children: [
              Icon(Icons.lock_reset_rounded, size: 48, color: p.accent),
              const SizedBox(height: HatlySpacing.sm),
              Text(l10n.tempPasswordExplanation,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyLarge),
              const SizedBox(height: HatlySpacing.lg),
              HatlyTextField(
                key: const Key('temp-password-current'),
                controller: _current,
                obscureText: true,
                hintText: l10n.tempPasswordCurrentLabel,
              ),
              const SizedBox(height: HatlySpacing.sm),
              HatlyTextField(
                key: const Key('temp-password-new'),
                controller: _next,
                obscureText: true,
                hintText: l10n.passwordHint,
              ),
              const SizedBox(height: HatlySpacing.sm),
              HatlyTextField(
                key: const Key('temp-password-confirm'),
                controller: _confirm,
                obscureText: true,
                hintText: l10n.tempPasswordConfirmLabel,
              ),
              const SizedBox(height: HatlySpacing.sm),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: HatlySpacing.sm),
                  child: Text(_error!,
                      key: const Key('temp-password-error'),
                      style: Theme.of(context)
                          .textTheme
                          .labelLarge
                          ?.copyWith(color: p.urgent)),
                ),
              HatlyButton(
                key: const Key('temp-password-save'),
                label: l10n.tempPasswordSave,
                isLoading: _saving,
                onPressed: _save,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
