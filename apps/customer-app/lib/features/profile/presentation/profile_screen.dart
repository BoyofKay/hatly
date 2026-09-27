import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_button.dart';
import '../../../shared_widgets/hatly_text_field.dart';
import '../../auth/data/auth_providers.dart';
import '../../auth/presentation/auth_error_messages.dart';
import '../../auth/presentation/session_controller.dart';
import '../../support/presentation/support_contact_action.dart';

/// The only functionally real screen in the Phase 2A shell besides
/// auth itself — everything else here is a placeholder, but logout
/// has to work end-to-end for the auth flow to be complete (spec:
/// "clear local authentication state on logout").
///
/// Customer Authentication Modes (master implementation) adds the
/// password setup section below — the smallest addition needed for
/// an authenticated Customer to set/change their password from a
/// real session (Section 8 of the approved design), without
/// redesigning this screen otherwise.
///
/// UI/UX-5A. Presentation-only Design System migration — password
/// setup and logout behavior, validation, and API calls are all
/// UNCHANGED from before this chunk. Placeholder content remains
/// exactly a placeholder — no new functionality (personal info,
/// notifications, payment methods, addresses, favorites, support) was
/// added here.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  bool _isLoggingOut = false;

  final _passwordController = TextEditingController();
  bool _isSavingPassword = false;
  String? _passwordErrorCode;
  bool _passwordSaved = false;

  @override
  void dispose() {
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.profile)),
      // Scrollable so the support entry (plus the keyboard / large text) never overflows this column.
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(HatlySpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.profileComingSoon,
                style: Theme.of(context).textTheme.bodyLarge),
            const SizedBox(height: HatlySpacing.lg),
            // Permanent general-support entry point (Approved UX). Stays visible but disabled, with a reason,
            // if the support number is not configured.
            SupportContactTile(
              key: const Key('profile-support-contact'),
              label: l10n.supportContactAction,
              messageBuilder: (l10n) => l10n.supportMessageGeneral,
            ),
            const SizedBox(height: HatlySpacing.xl),
            Text(l10n.passwordSetupSectionTitle,
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: HatlySpacing.xs),
            Text(l10n.passwordSetupSectionSubtitle,
                style: Theme.of(context).textTheme.bodyLarge),
            const SizedBox(height: HatlySpacing.ms),
            HatlyTextField(
              controller: _passwordController,
              obscureText: true,
              hintText: l10n.passwordHint,
            ),
            const SizedBox(height: HatlySpacing.sm),
            if (_passwordErrorCode != null)
              Padding(
                padding: const EdgeInsets.only(bottom: HatlySpacing.sm),
                child: Text(
                  localizedErrorMessage(context, _passwordErrorCode),
                  style: Theme.of(context)
                      .textTheme
                      .labelLarge
                      ?.copyWith(color: HatlyColors.error),
                ),
              ),
            if (_passwordSaved)
              Padding(
                padding: const EdgeInsets.only(bottom: HatlySpacing.sm),
                child: Text(
                  l10n.passwordSetupSuccess,
                  style: Theme.of(context)
                      .textTheme
                      .labelLarge
                      ?.copyWith(color: HatlyColors.success),
                ),
              ),
            HatlyButton(
              label: l10n.passwordSetupSaveButton,
              isLoading: _isSavingPassword,
              onPressed: _savePassword,
            ),
            const SizedBox(height: HatlySpacing.xl),
            HatlyButton(
              label: l10n.logout,
              isLoading: _isLoggingOut,
              onPressed: _logout,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _savePassword() async {
    if (_isSavingPassword) return;
    setState(() {
      _isSavingPassword = true;
      _passwordErrorCode = null;
      _passwordSaved = false;
    });
    try {
      await ref
          .read(authRepositoryProvider)
          .setPassword(password: _passwordController.text);
      setState(() {
        _isSavingPassword = false;
        _passwordSaved = true;
      });
      _passwordController.clear();
    } on ApiException catch (e) {
      setState(() {
        _isSavingPassword = false;
        _passwordErrorCode = e.businessCode ?? e.code;
      });
    }
  }

  Future<void> _logout() async {
    setState(() => _isLoggingOut = true);
    // The router's redirect (see app_router.dart) reacts to
    // SessionStatus flipping to unauthenticated and sends the user
    // back to phone entry automatically — this screen doesn't need to
    // navigate itself.
    await ref.read(sessionControllerProvider.notifier).logout();
    if (mounted) setState(() => _isLoggingOut = false);
  }
}
