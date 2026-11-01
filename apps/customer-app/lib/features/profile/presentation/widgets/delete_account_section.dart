import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_text_field.dart';
import '../../../auth/presentation/session_controller.dart';

/// Profile > "Delete my account". Both app stores require an in-app way to delete an account. The dialog says what is erased and kept
/// and what blocks deletion BEFORE asking for the password; the backend re-checks everything (password, orders in flight, wallet) and
/// this widget only shows its refusal in the customer's language. On success the session ends and the router returns to sign-in.
class DeleteAccountSection extends ConsumerWidget {
  const DeleteAccountSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return Align(
      alignment: AlignmentDirectional.center,
      child: TextButton(
        key: const Key('delete-account-entry'),
        style: TextButton.styleFrom(foregroundColor: p.urgent),
        onPressed: () => showDialog<void>(
            context: context, builder: (_) => const _DeleteAccountDialog()),
        child: Text(l10n.deleteAccountAction),
      ),
    );
  }
}

class _DeleteAccountDialog extends ConsumerStatefulWidget {
  const _DeleteAccountDialog();

  @override
  ConsumerState<_DeleteAccountDialog> createState() =>
      _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends ConsumerState<_DeleteAccountDialog> {
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  String _messageFor(AppLocalizations l10n, ApiException e) {
    switch (e.businessCode) {
      case 'ACCOUNT_HAS_ACTIVE_ORDERS':
        return l10n.deleteAccountErrorActiveOrders;
      case 'ACCOUNT_HAS_WALLET_BALANCE':
        return l10n.deleteAccountErrorWalletBalance;
      case 'PASSWORD_INVALID':
        return l10n.deleteAccountErrorPassword;
      default:
        return e.code == 'NETWORK_ERROR'
            ? l10n.errorNetwork
            : l10n.deleteAccountErrorGeneric;
    }
  }

  Future<void> _confirm() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context);
    if (_password.text.isEmpty) {
      setState(() => _error = l10n.deleteAccountPasswordRequired);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(sessionControllerProvider.notifier)
          .deleteAccount(password: _password.text);
      if (mounted)
        Navigator.of(context)
            .pop(); // the router's redirect takes the signed-out customer to sign-in
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = _messageFor(l10n, e);
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = l10n.deleteAccountErrorGeneric;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return AlertDialog(
      title: Text(l10n.deleteAccountTitle),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.deleteAccountExplanation),
            const SizedBox(height: HatlySpacing.sm),
            Text(l10n.deleteAccountRequirements,
                style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: HatlySpacing.md),
            HatlyTextField(
              key: const Key('delete-account-password-field'),
              controller: _password,
              obscureText: true,
              hintText: l10n.deleteAccountPasswordHint,
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: HatlySpacing.sm),
                child: Text(_error!,
                    key: const Key('delete-account-error'),
                    style: Theme.of(context)
                        .textTheme
                        .labelLarge
                        ?.copyWith(color: p.urgent)),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          key: const Key('delete-account-cancel'),
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: Text(l10n.deleteAccountCancel),
        ),
        TextButton(
          key: const Key('delete-account-confirm'),
          style: TextButton.styleFrom(foregroundColor: p.urgent),
          onPressed: _busy ? null : _confirm,
          child: _busy
              ? const SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : Text(l10n.deleteAccountConfirm),
        ),
      ],
    );
  }
}
