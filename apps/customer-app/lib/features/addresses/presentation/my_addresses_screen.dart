import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../../../core/theme/hatly_theme.dart';
import '../data/addresses_providers.dart';
import '../domain/saved_address.dart';
import 'widgets/address_area_lines.dart';

/// My Addresses ("عناويني", Profile). Reuses the EXACT existing address
/// infrastructure `AddressSelectionScreen` (Checkout) already
/// established — same [savedAddressesProvider], same [AddressesApi],
/// same [SavedAddress]/[AddressInput] model, same `/addresses/add`
/// create-and-edit screen, same coordinate-authoritative map picker.
/// This is a SEPARATE screen (not a mode flag on
/// `AddressSelectionScreen`) because the two have genuinely different
/// tap semantics: Checkout's screen selects-and-pops an address for the
/// order in progress; this one manages the list itself — tapping a
/// row edits it, and a non-default address can be promoted to default.
/// Neither screen touches the other's route or behavior.
class MyAddressesScreen extends ConsumerStatefulWidget {
  const MyAddressesScreen({super.key});

  @override
  ConsumerState<MyAddressesScreen> createState() => _MyAddressesScreenState();
}

class _MyAddressesScreenState extends ConsumerState<MyAddressesScreen> {
  // Per-address in-flight guards — same convention as
  // AddressSelectionScreen's own `_deletingIds`: prevents a duplicate
  // delete/set-default submission for the same address while one is
  // already running, without any global loading architecture.
  final Set<String> _deletingIds = {};
  final Set<String> _settingDefaultIds = {};

  Future<void> _confirmAndDelete(SavedAddress address) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.addressDeleteConfirmTitle),
        content: Text(l10n.addressDeleteConfirmMessage),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(l10n.cancel)),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.addressDeleteAction),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!mounted || _deletingIds.contains(address.id)) return;

    setState(() => _deletingIds.add(address.id));
    try {
      await ref.read(addressesApiProvider).deactivateAddress(address.id);
      ref.invalidate(savedAddressesProvider);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(AppLocalizations.of(context).addressDeleteError)),
        );
      }
    } finally {
      if (mounted) setState(() => _deletingIds.remove(address.id));
    }
  }

  Future<void> _setDefault(SavedAddress address) async {
    if (address.isDefault || _settingDefaultIds.contains(address.id)) return;
    setState(() => _settingDefaultIds.add(address.id));
    try {
      // Reuses the existing PATCH /addresses/:id — every other field is
      // sent back unchanged (see SavedAddressToInput's own comment); the
      // backend's own `update()` clears the previous default atomically.
      await ref
          .read(addressesApiProvider)
          .setDefaultAddress(address.id);
      ref.invalidate(savedAddressesProvider);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content:
                  Text(AppLocalizations.of(context).addressSetDefaultError)),
        );
      }
    } finally {
      if (mounted) setState(() => _settingDefaultIds.remove(address.id));
    }
  }

  Future<void> _edit(SavedAddress address) async {
    await context.push('/addresses/add', extra: address);
    if (mounted) ref.invalidate(savedAddressesProvider);
  }

  Future<void> _addNew() async {
    await context.push<SavedAddress>('/addresses/add');
    if (mounted) ref.invalidate(savedAddressesProvider);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final addressesAsync = ref.watch(savedAddressesProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.profileMyAddresses),
        actions: [
          TextButton(
            key: const Key('my-addresses-add'),
            onPressed: _addNew,
            child: Text(l10n.addressAddNew),
          ),
        ],
      ),
      body: addressesAsync.when(
        loading: () => const HatlyLoadingView(),
        error: (error, _) => HatlyStateView(
          icon: Icons.error_outline,
          title: l10n.somethingWentWrong,
          retryLabel: l10n.retry,
          onRetry: () => ref.invalidate(savedAddressesProvider),
        ),
        data: (addresses) {
          if (addresses.isEmpty) {
            // Polish pass: was `subtitle: l10n.addressAddNew` — plain,
            // non-interactive text reading exactly like the real "Add New
            // Address" button in the AppBar above it, but inert. Reusing
            // `HatlyStateView`'s existing retry-button slot (used by the
            // error branch just above) makes it an actual working action.
            return HatlyStateView(
              icon: Icons.location_off_outlined,
              title: l10n.addressNoneSavedYet,
              retryLabel: l10n.addressAddNew,
              onRetry: _addNew,
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(HatlySpacing.md),
            itemCount: addresses.length,
            separatorBuilder: (context, index) =>
                const SizedBox(height: HatlySpacing.sm),
            itemBuilder: (context, index) {
              final address = addresses[index];
              return _AddressTile(
                key: Key('my-address-tile-${address.id}'),
                address: address,
                isDeleting: _deletingIds.contains(address.id),
                isSettingDefault: _settingDefaultIds.contains(address.id),
                onTap: () => _edit(address),
                onEdit: () => _edit(address),
                onDelete: () => _confirmAndDelete(address),
                onSetDefault: () => _setDefault(address),
              );
            },
          );
        },
      ),
    );
  }
}

class _AddressTile extends StatelessWidget {
  const _AddressTile({
    super.key,
    required this.address,
    required this.isDeleting,
    required this.isSettingDefault,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
    required this.onSetDefault,
  });

  final SavedAddress address;
  final bool isDeleting;
  final bool isSettingDefault;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onSetDefault;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final busy = isDeleting || isSettingDefault;

    return HatlySurface(
      onTap: busy ? null : onTap,
      semanticLabel: address.label?.isNotEmpty == true
          ? '${address.label}, ${address.line1}'
          : address.line1,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.location_on_outlined, color: p.textMuted),
          const SizedBox(width: HatlySpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        address.label?.isNotEmpty == true
                            ? address.label!
                            : address.line1,
                        style: context.type.title,
                      ),
                    ),
                    if (address.isDefault) ...[
                      const SizedBox(width: HatlySpacing.sm),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: HatlySpacing.sm, vertical: 2),
                        decoration: BoxDecoration(
                          color: p.accentSoft,
                          borderRadius: BorderRadius.circular(HatlyRadius.chip),
                        ),
                        child: Text(l10n.checkoutDefaultAddress,
                            style:
                                context.type.caption.copyWith(color: p.link)),
                      ),
                    ],
                  ],
                ),
                if (address.label?.isNotEmpty == true)
                  Text(address.line1, style: context.type.small),
                AddressAreaLines(address: address),
                if (!address.isDefault) ...[
                  const SizedBox(height: HatlySpacing.xs),
                  isSettingDefault
                      ? SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: p.link),
                        )
                      : InkWell(
                          key: Key('address-set-default-${address.id}'),
                          onTap: busy ? null : onSetDefault,
                          child: Text(l10n.addressSetDefaultAction,
                              style: context.type.caption.copyWith(
                                  color: p.link, fontWeight: FontWeight.w700)),
                        ),
                ],
              ],
            ),
          ),
          // A nested IconButton has its own ink response, which
          // consumes the tap before it bubbles up to HatlySurface's own
          // onTap — same confirmed gesture-disambiguation this pattern
          // already relies on in AddressSelectionScreen.
          IconButton(
            icon: Icon(Icons.edit_outlined, color: p.textMuted),
            tooltip: l10n.editAddressTitle,
            onPressed: busy ? null : onEdit,
          ),
          isDeleting
              ? const Padding(
                  padding: EdgeInsets.all(HatlySpacing.sm),
                  child: SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : IconButton(
                  icon: Icon(Icons.delete_outline, color: p.urgent),
                  tooltip: l10n.addressDeleteAction,
                  onPressed: busy ? null : onDelete,
                ),
        ],
      ),
    );
  }
}
