import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../shared_widgets/hatly_button.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../../../shared_widgets/hatly_text_field.dart';
import '../../addresses/data/addresses_providers.dart';
import '../../addresses/domain/saved_address.dart';
import '../../auth/data/auth_providers.dart';
import '../../auth/presentation/auth_error_messages.dart';
import '../../auth/presentation/session_controller.dart';
import '../../support/presentation/support_contact_action.dart';
import '../../wallet/data/wallet_providers.dart';
import '../../wallet/domain/wallet_transaction.dart';
import '../../loyalty/data/loyalty_providers.dart';
import '../../loyalty/domain/loyalty_transaction.dart';
import 'widgets/theme_mode_selector.dart';

/// The customer's approved, minimal Profile: a header, the real
/// default address (with a link to manage the full list), the real
/// Wallet balance (with a link to its history), password setup,
/// support, and logout. Deliberately not a settings dashboard — every
/// section here reads real backend data (savedAddressesProvider /
/// walletBalanceProvider), never a placeholder.
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
    final p = context.palette;
    final addressesAsync = ref.watch(savedAddressesProvider);
    final balanceAsync = ref.watch(walletBalanceProvider);
    final loyaltyBalanceAsync = ref.watch(loyaltyBalanceProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.profile)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(HatlySpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _DefaultAddressCard(addressesAsync: addressesAsync),
            const SizedBox(height: HatlySpacing.md),
            _WalletCard(balanceAsync: balanceAsync),
            const SizedBox(height: HatlySpacing.md),
            _LoyaltyCard(balanceAsync: loyaltyBalanceAsync),
            const SizedBox(height: HatlySpacing.md),
            // Dark Mode — the one customer-facing control for it (Phase 6).
            // Kept as a single compact card, not a settings dashboard.
            const ThemeModeSelector(),
            const SizedBox(height: HatlySpacing.xl),
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
                      ?.copyWith(color: p.urgent),
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
                      ?.copyWith(color: p.success),
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
    if (_isLoggingOut) return;
    setState(() => _isLoggingOut = true);
    // The router's redirect (see app_router.dart) reacts to
    // SessionStatus flipping to unauthenticated and sends the user
    // back to phone entry automatically — this screen doesn't need to
    // navigate itself.
    await ref.read(sessionControllerProvider.notifier).logout();
    if (mounted) setState(() => _isLoggingOut = false);
  }
}

class _DefaultAddressCard extends StatelessWidget {
  const _DefaultAddressCard({required this.addressesAsync});

  final AsyncValue<List<SavedAddress>> addressesAsync;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final chevron = Directionality.of(context) == TextDirection.rtl
        ? Icons.chevron_left
        : Icons.chevron_right;

    String? subtitle;
    final addresses = addressesAsync.valueOrNull;
    if (addresses != null) {
      for (final a in addresses) {
        if (a.isDefault) {
          subtitle = a.label?.isNotEmpty == true ? a.label! : a.line1;
          break;
        }
      }
    }

    return HatlySurface(
      key: const Key('profile-default-address-card'),
      onTap: () => context.push('/profile/addresses'),
      child: Row(
        children: [
          Icon(Icons.location_on_outlined, color: p.textMuted),
          const SizedBox(width: HatlySpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.profileMyAddresses, style: context.type.title),
                const SizedBox(height: 2),
                Text(
                  addressesAsync.isLoading
                      ? ''
                      : (subtitle ?? l10n.profileNoDefaultAddress),
                  key: const Key('profile-default-address-subtitle'),
                  style: context.type.caption,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          Text(l10n.profileManageAddresses,
              style: context.type.caption
                  .copyWith(color: p.link, fontWeight: FontWeight.w700)),
          Icon(chevron, color: p.textMuted),
        ],
      ),
    );
  }
}

class _WalletCard extends StatelessWidget {
  const _WalletCard({required this.balanceAsync});

  final AsyncValue<WalletBalance> balanceAsync;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final chevron = Directionality.of(context) == TextDirection.rtl
        ? Icons.chevron_left
        : Icons.chevron_right;

    return HatlySurface(
      key: const Key('profile-wallet-card'),
      onTap: () => context.push('/profile/wallet'),
      child: Row(
        children: [
          CircleAvatar(
            backgroundColor: p.accentSoft,
            foregroundColor: p.accent,
            child: const Icon(Icons.account_balance_wallet_outlined),
          ),
          const SizedBox(width: HatlySpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.profileWalletCardTitle, style: context.type.title),
                const SizedBox(height: 2),
                balanceAsync.when(
                  loading: () => Text(l10n.walletBalanceLabel,
                      style: context.type.caption),
                  error: (error, _) => Text(l10n.somethingWentWrong,
                      style: context.type.caption),
                  data: (balance) => Text(
                    formatMinorUnits(balance.balanceMinor, context),
                    key: const Key('profile-wallet-balance'),
                    style: context.type.body.copyWith(
                        fontWeight: FontWeight.w800, color: p.success),
                  ),
                ),
              ],
            ),
          ),
          Icon(chevron, color: p.textMuted),
        ],
      ),
    );
  }
}

/// Consolidated customer-commerce milestone (Parts C/D — Loyalty V1 +
/// conversion). Mirrors `_WalletCard` exactly.
class _LoyaltyCard extends StatelessWidget {
  const _LoyaltyCard({required this.balanceAsync});

  final AsyncValue<LoyaltyBalance> balanceAsync;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final chevron = Directionality.of(context) == TextDirection.rtl
        ? Icons.chevron_left
        : Icons.chevron_right;

    return HatlySurface(
      key: const Key('profile-loyalty-card'),
      onTap: () => context.push('/profile/loyalty'),
      child: Row(
        children: [
          CircleAvatar(
            backgroundColor: p.accentSoft,
            foregroundColor: p.accent,
            child: const Icon(Icons.stars_rounded),
          ),
          const SizedBox(width: HatlySpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.profileLoyaltyCardTitle, style: context.type.title),
                const SizedBox(height: 2),
                balanceAsync.when(
                  loading: () => Text(l10n.loyaltyBalanceLabel,
                      style: context.type.caption),
                  error: (error, _) => Text(l10n.somethingWentWrong,
                      style: context.type.caption),
                  data: (balance) => Text(
                    '${balance.pointsBalance} ${l10n.loyaltyPointsSuffix}',
                    key: const Key('profile-loyalty-balance'),
                    style: context.type.body.copyWith(
                        fontWeight: FontWeight.w800, color: p.success),
                  ),
                ),
              ],
            ),
          ),
          Icon(chevron, color: p.textMuted),
        ],
      ),
    );
  }
}
