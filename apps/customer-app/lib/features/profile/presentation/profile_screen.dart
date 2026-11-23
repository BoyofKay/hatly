import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../shared_widgets/hatly_button.dart';
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
import '../../home/domain/home_content.dart';
import '../../home/presentation/widgets/home_promo_actions.dart';
import '../../shell/presentation/shell_tab_provider.dart';

/// The customer's Profile (reference board): an orange header, then one menu
/// list — the real default address, the real Wallet and points balances,
/// Favorites, Offers, support and Settings — then logout. Every value here is
/// real backend data (savedAddressesProvider / walletBalanceProvider /
/// loyaltyBalanceProvider), never a placeholder. Appearance, language,
/// password and account deletion live on the Settings screen.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  bool _isLoggingOut = false;
  bool _isSavingName = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final addressesAsync = ref.watch(savedAddressesProvider);
    final balanceAsync = ref.watch(walletBalanceProvider);
    final loyaltyBalanceAsync = ref.watch(loyaltyBalanceProvider);
    final name = ref.watch(displayNameProvider).valueOrNull;

    return Scaffold(
      body: SingleChildScrollView(
        padding: const EdgeInsets.only(bottom: HatlySpacing.xl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Reference board: a full-width orange header with the avatar centred, then one menu list.
            _ProfileHeader(name: name),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  HatlySpacing.md, HatlySpacing.lg, HatlySpacing.md, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _ProfileGroup(children: [
                    _ProfileRow(
                      key: const Key('profile-edit-name'),
                      icon: Icons.badge_outlined,
                      title: l10n.fullNameLabel,
                      value: Text(name?.trim().isNotEmpty == true ? name! : '—',
                        key: const Key('profile-displayed-name'),
                        style: context.type.caption),
                      trailing: _isSavingName
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.edit_outlined, size: 18),
                      onTap: _isSavingName ? () {} : _editName,
                    ),
                    _DefaultAddressCard(addressesAsync: addressesAsync),
                    _WalletCard(balanceAsync: balanceAsync),
                    _LoyaltyCard(balanceAsync: loyaltyBalanceAsync),
                    _ProfileRow(
                      key: const Key('profile-favorites-row'),
                      icon: Icons.favorite_border_rounded,
                      title: l10n.favorites,
                      onTap: () => ref
                          .read(shellTabIndexProvider.notifier)
                          .state = ShellTab.favorites,
                    ),
                    _ProfileRow(
                      key: const Key('profile-offers-row'),
                      icon: Icons.local_offer_outlined,
                      title: l10n.homeSectionOffers,
                      onTap: () => context
                          .push(homeSectionRoute(HomeSectionKind.offers)),
                    ),
                  ]),
                  const SizedBox(height: HatlySpacing.md),
                  _ProfileGroup(children: [
                    // Permanent general-support entry point (Approved UX). Stays visible but disabled, with a reason,
                    // if the support number is not configured.
                    SupportContactTile(
                      key: const Key('profile-support-contact'),
                      label: l10n.supportContactAction,
                      messageBuilder: (l10n) => l10n.supportMessageGeneral,
                      flat: true,
                    ),
                    _ProfileRow(
                      key: const Key('profile-settings-row'),
                      icon: Icons.settings_outlined,
                      title: l10n.profileSettings,
                      onTap: () => context.push('/profile/settings'),
                    ),
                  ]),
                  const SizedBox(height: HatlySpacing.lg),
                  HatlyButton(
                    label: l10n.logout,
                    isLoading: _isLoggingOut,
                    onPressed: _logout,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _editName() async {
    final current = ref.read(displayNameProvider).valueOrNull ?? '';
    final controller = TextEditingController(text: current);
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final submitted = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(ar ? 'تعديل الاسم' : 'Edit name'),
        content: TextField(
          key: const Key('customer-name-input'),
          controller: controller,
          autofocus: true,
          maxLength: 150,
          textCapitalization: TextCapitalization.words,
          decoration: InputDecoration(labelText: ar ? 'الاسم الكامل' : 'Full name'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext),
            child: Text(ar ? 'إلغاء' : 'Cancel')),
          FilledButton(
            key: const Key('customer-name-save'),
            onPressed: () {
              final name = controller.text.trim();
              if (name.length >= 2) Navigator.pop(dialogContext, name);
            },
            child: Text(ar ? 'حفظ' : 'Save'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (!mounted || submitted == null || submitted == current) return;
    setState(() => _isSavingName = true);
    try {
      await ref.read(authRepositoryProvider).updateDisplayName(submitted);
      ref.invalidate(displayNameProvider);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ar ? 'تم تحديث الاسم' : 'Name updated')));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ar ? 'تعذّر حفظ الاسم. حاول مرة أخرى.' : 'Could not save your name. Try again.')));
    } finally {
      if (mounted) setState(() => _isSavingName = false);
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

/// The top of the account (reference board): a full-width orange header that runs under the status bar, with the title, a
/// centred white avatar (the customer's initial when the name is known on this device) and the name below it.
class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.name});

  final String? name;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final trimmed = name?.trim() ?? '';
    final initial =
        trimmed.isEmpty ? null : trimmed.characters.first.toUpperCase();
    return Container(
      key: const Key('profile-header'),
      padding: EdgeInsets.fromLTRB(
          HatlySpacing.md,
          MediaQuery.paddingOf(context).top + HatlySpacing.sm,
          HatlySpacing.md,
          HatlySpacing.lg),
      decoration: BoxDecoration(
        borderRadius: const BorderRadius.vertical(
            bottom: Radius.circular(HatlyRadius.promoBanner + 8)),
        gradient: LinearGradient(
          begin: AlignmentDirectional.topStart,
          end: AlignmentDirectional.bottomEnd,
          colors: [
            p.accent,
            Color.lerp(p.accent, const Color(0xFFFFA65C), 0.6)!
          ],
        ),
      ),
      child: Column(
        children: [
          SizedBox(
            height: 44,
            child: Center(
              child: Text(l10n.profile,
                  style: context.type.title.copyWith(
                      color: p.accentOn, fontWeight: FontWeight.w800)),
            ),
          ),
          const SizedBox(height: HatlySpacing.sm),
          Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
                color: HatlyColors.surfaceWhite.withValues(alpha: 0.35),
                shape: BoxShape.circle),
            child: CircleAvatar(
              radius: 40,
              backgroundColor: HatlyColors.surfaceWhite,
              foregroundColor: HatlyColors.primaryOrangeDark,
              child: initial == null
                  ? const Icon(Icons.person_rounded, size: 44)
                  : Text(initial,
                      style: context.type.h1
                          .copyWith(color: HatlyColors.primaryOrangeDark)),
            ),
          ),
          if (trimmed.isNotEmpty) ...[
            const SizedBox(height: HatlySpacing.ms),
            Text(
              trimmed,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              // Dark ink on the brand orange (7:1) — the palette's accessibility rule.
              style: context.type.h2
                  .copyWith(color: p.accentOn, fontWeight: FontWeight.w800),
            ),
          ],
        ],
      ),
    );
  }
}

/// A white rounded group holding several rows, separated by hairlines.
class _ProfileGroup extends StatelessWidget {
  const _ProfileGroup({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(HatlyRadius.card),
        boxShadow: HatlyShadows.soft(p),
      ),
      child: Column(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0)
              Divider(
                  height: 1,
                  thickness: 1,
                  indent: HatlySpacing.md + 40 + HatlySpacing.ms,
                  color: p.border),
            children[i],
          ],
        ],
      ),
    );
  }
}

/// One row of a [_ProfileGroup]: soft icon, title + value, trailing chevron.
class _ProfileRow extends StatelessWidget {
  const _ProfileRow({
    super.key,
    required this.icon,
    required this.title,
    this.value,
    required this.onTap,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final Widget? value;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    // chevron_right is a directional icon: Flutter mirrors it in RTL, so it always points "forward".
    const chevron = Icons.chevron_right;
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: HatlySpacing.md, vertical: HatlySpacing.ms),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                    color: p.accentSoft,
                    borderRadius: BorderRadius.circular(HatlyRadius.button)),
                child: Icon(icon, color: p.accent, size: 22),
              ),
              const SizedBox(width: HatlySpacing.ms),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: context.type.body
                            .copyWith(fontWeight: FontWeight.w700)),
                    if (value != null) ...[
                      const SizedBox(height: 2),
                      value!,
                    ],
                  ],
                ),
              ),
              if (trailing != null) trailing!,
              Icon(chevron, color: p.textMuted),
            ],
          ),
        ),
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

    return _ProfileRow(
      key: const Key('profile-default-address-card'),
      onTap: () => context.push('/profile/addresses'),
      icon: Icons.location_on_outlined,
      title: l10n.profileMyAddresses,
      value: Text(
        addressesAsync.isLoading
            ? ''
            : (subtitle ?? l10n.profileNoDefaultAddress),
        key: const Key('profile-default-address-subtitle'),
        style: context.type.caption,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: Text(l10n.profileManageAddresses,
          style: context.type.caption
              .copyWith(color: p.link, fontWeight: FontWeight.w700)),
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
    return _ProfileRow(
      key: const Key('profile-wallet-card'),
      onTap: () => context.push('/profile/wallet'),
      icon: Icons.account_balance_wallet_outlined,
      title: l10n.profileWalletCardTitle,
      value: balanceAsync.when(
        loading: () =>
            Text(l10n.walletBalanceLabel, style: context.type.caption),
        error: (error, _) =>
            Text(l10n.somethingWentWrong, style: context.type.caption),
        data: (balance) => Text(
          formatMinorUnits(balance.balanceMinor, context),
          key: const Key('profile-wallet-balance'),
          style: context.type.small
              .copyWith(fontWeight: FontWeight.w800, color: p.success),
        ),
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
    return _ProfileRow(
      key: const Key('profile-loyalty-card'),
      onTap: () => context.push('/profile/loyalty'),
      icon: Icons.stars_rounded,
      title: l10n.profileLoyaltyCardTitle,
      value: balanceAsync.when(
        loading: () =>
            Text(l10n.loyaltyBalanceLabel, style: context.type.caption),
        error: (error, _) =>
            Text(l10n.somethingWentWrong, style: context.type.caption),
        data: (balance) => Text(
          '${balance.pointsBalance} ${l10n.loyaltyPointsSuffix}',
          key: const Key('profile-loyalty-balance'),
          style: context.type.small
              .copyWith(fontWeight: FontWeight.w800, color: p.success),
        ),
      ),
    );
  }
}
