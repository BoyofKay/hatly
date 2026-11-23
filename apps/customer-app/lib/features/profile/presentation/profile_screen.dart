import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../shared_widgets/hatly_button.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../../addresses/data/addresses_providers.dart';
import '../../addresses/domain/saved_address.dart';
import '../../auth/presentation/display_name_provider.dart';
import '../../auth/data/auth_providers.dart';
import '../../auth/presentation/session_controller.dart';
import '../../support/presentation/support_contact_action.dart';
import '../../wallet/data/wallet_providers.dart';
import '../../wallet/domain/wallet_transaction.dart';
import '../../loyalty/data/loyalty_providers.dart';
import '../../loyalty/domain/loyalty_transaction.dart';
import 'widgets/delete_account_section.dart';
import 'widgets/password_change_section.dart';
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

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
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
            _ProfileHeader(name: ref.watch(displayNameProvider).valueOrNull, onEdit: _editName),
            const SizedBox(height: HatlySpacing.md),
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
            const PasswordChangeSection(),
            const SizedBox(height: HatlySpacing.xl),
            HatlyButton(
              label: l10n.logout,
              isLoading: _isLoggingOut,
              onPressed: _logout,
            ),
            const SizedBox(height: HatlySpacing.md),
            const DeleteAccountSection(),
          ],
        ),
      ),
    );
  }

  Future<void> _editName() async {
    final currentName = await ref.read(displayNameProvider.future);
    if (!mounted) return;
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final controller = TextEditingController(text: currentName ?? '');
    final edited = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(ar ? 'تعديل الاسم' : 'Edit name'),
        content: TextField(
          key: const Key('profile-name-input'),
          controller: controller,
          autofocus: true,
          maxLength: 150,
          textCapitalization: TextCapitalization.words,
          decoration: InputDecoration(labelText: ar ? 'الاسم' : 'Your name'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: Text(ar ? 'إلغاء' : 'Cancel')),
          FilledButton(
            onPressed: () {
              final value = controller.text.trim();
              if (value.length >= 2) Navigator.pop(dialogContext, value);
            },
            child: Text(ar ? 'حفظ' : 'Save'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (edited == null || edited == currentName || !mounted) return;
    try {
      await ref.read(authRepositoryProvider).updateDisplayName(edited);
      ref.invalidate(displayNameProvider);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ar ? 'تم تحديث الاسم' : 'Name updated')));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ar ? 'تعذر تحديث الاسم، حاول مرة أخرى' : 'Could not update name. Try again.')));
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

/// The top of the account: an orange avatar with the customer's initial and, when it is known on this device, their name.
class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.name, required this.onEdit});

  final String? name;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final trimmed = name?.trim() ?? '';
    final initial =
        trimmed.isEmpty ? null : trimmed.characters.first.toUpperCase();
    return Container(
      key: const Key('profile-header'),
      padding: const EdgeInsets.all(HatlySpacing.md),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(HatlyRadius.card),
        gradient: LinearGradient(
          begin: AlignmentDirectional.topStart,
          end: AlignmentDirectional.bottomEnd,
          colors: [p.accentSoft, p.accentSoft.withValues(alpha: 0.4)],
        ),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 28,
            backgroundColor: p.accent,
            foregroundColor: p.accentOn,
            child: initial == null
                ? const Icon(Icons.person_rounded, size: 30)
                : Text(initial,
                    style: context.type.h2.copyWith(color: p.accentOn)),
          ),
          const SizedBox(width: HatlySpacing.ms),
          Expanded(
            child: Text(
              trimmed.isEmpty ? l10n.profile : trimmed,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.type.h2,
            ),
          ),
          IconButton(
            key: const Key('profile-edit-name'),
            tooltip: Localizations.localeOf(context).languageCode == 'ar' ? 'تعديل الاسم' : 'Edit name',
            onPressed: onEdit,
            icon: const Icon(Icons.edit_outlined),
          ),
        ],
      ),
    );
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
          CircleAvatar(
            backgroundColor: p.accentSoft,
            foregroundColor: p.accent,
            child: const Icon(Icons.location_on_outlined),
          ),
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
