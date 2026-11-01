import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_button.dart';
import '../../../../shared_widgets/hatly_text_field.dart';
import '../../../auth/data/auth_providers.dart';
import '../../../auth/presentation/auth_error_messages.dart';

/// Profile > password. Every account has a password, so changing it always needs the CURRENT one (a session alone is not
/// enough — the backend enforces it, and this form checks it before sending).
class PasswordChangeSection extends ConsumerStatefulWidget {
  const PasswordChangeSection({super.key});

  @override
  ConsumerState<PasswordChangeSection> createState() =>
      _PasswordChangeSectionState();
}

class _PasswordChangeSectionState extends ConsumerState<PasswordChangeSection> {
  static const _minPasswordLength = 8;

  final _currentController = TextEditingController();
  final _newController = TextEditingController();
  bool _isSaving = false;
  String? _errorCode;
  String? _localError;
  bool _saved = false;

  @override
  void dispose() {
    _currentController.dispose();
    _newController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final error = _localError ??
        (_errorCode != null
            ? localizedPasswordChangeError(context, _errorCode)
            : null);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.passwordSetupSectionTitle,
            style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: HatlySpacing.xs),
        Text(l10n.passwordSetupSectionSubtitle,
            style: Theme.of(context).textTheme.bodyLarge),
        const SizedBox(height: HatlySpacing.ms),
        HatlyTextField(
          key: const Key('current-password-field'),
          controller: _currentController,
          obscureText: true,
          hintText: l10n.profileCurrentPasswordLabel,
        ),
        const SizedBox(height: HatlySpacing.sm),
        HatlyTextField(
          key: const Key('new-password-field'),
          controller: _newController,
          obscureText: true,
          hintText: l10n.passwordHint,
        ),
        const SizedBox(height: HatlySpacing.sm),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: HatlySpacing.sm),
            child: Text(error,
                style: Theme.of(context)
                    .textTheme
                    .labelLarge
                    ?.copyWith(color: p.urgent)),
          ),
        if (_saved)
          Padding(
            padding: const EdgeInsets.only(bottom: HatlySpacing.sm),
            child: Text(l10n.passwordSetupSuccess,
                style: Theme.of(context)
                    .textTheme
                    .labelLarge
                    ?.copyWith(color: p.success)),
          ),
        HatlyButton(
          label: l10n.passwordSetupSaveButton,
          isLoading: _isSaving,
          onPressed: _save,
        ),
      ],
    );
  }

  Future<void> _save() async {
    if (_isSaving) return;
    final l10n = AppLocalizations.of(context);
    if (_currentController.text.isEmpty) {
      setState(() {
        _localError = l10n.errorCurrentPasswordRequired;
        _errorCode = null;
        _saved = false;
      });
      return;
    }
    if (_newController.text.length < _minPasswordLength) {
      setState(() {
        _localError = l10n.passwordTooShort;
        _errorCode = null;
        _saved = false;
      });
      return;
    }
    setState(() {
      _isSaving = true;
      _localError = null;
      _errorCode = null;
      _saved = false;
    });
    try {
      await ref.read(authRepositoryProvider).setPassword(
            password: _newController.text,
            currentPassword: _currentController.text,
          );
      if (!mounted) return;
      setState(() {
        _isSaving = false;
        _saved = true;
      });
      _currentController.clear();
      _newController.clear();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _isSaving = false;
        _errorCode = e.businessCode ?? e.code;
      });
    }
  }
}
