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

/// Returned via `context.pop(savedAddress)` — the caller (CheckoutScreen)
/// awaits `context.push<SavedAddress>('/checkout/address')`.
///
/// UI/UX-5B + delete follow-up. Presentation-only Design System
/// migration plus one UI wiring change — `savedAddressesProvider`,
/// tap-to-select (`context.pop(address)`), add-address navigation,
/// and loading/error/empty semantics are all UNCHANGED. The delete
/// action below calls the existing, unmodified
/// `AddressesApi.deactivateAddress` — no new backend endpoint, no new
/// business rule (no default-address/edit/deletion-restriction logic
/// was introduced).
class AddressSelectionScreen extends ConsumerStatefulWidget {
  const AddressSelectionScreen({super.key});

  @override
  ConsumerState<AddressSelectionScreen> createState() =>
      _AddressSelectionScreenState();
}

class _AddressSelectionScreenState
    extends ConsumerState<AddressSelectionScreen> {
  // Local-only, per-screen state — CONFIRMED no global loading
  // architecture introduced. Tracks which address ids currently have
  // a delete request in flight, both to show feedback and to prevent
  // a duplicate delete submission for the same address while one is
  // already running.
  final Set<String> _deletingIds = {};

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

    // Cancelled (or dialog dismissed): do nothing, address unchanged.
    if (confirmed != true) return;
    if (!mounted || _deletingIds.contains(address.id)) return;

    setState(() => _deletingIds.add(address.id));
    try {
      await ref.read(addressesApiProvider).deactivateAddress(address.id);
      // Success — refresh from the backend, stay on this screen, do
      // not pop an address (deleting is never a selection).
      ref.invalidate(savedAddressesProvider);
    } catch (error) {
      // Failure — the address stays visible (the list is only ever
      // refreshed from the backend, never optimistically removed
      // here), and the customer sees a clear, localized error.
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

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final addressesAsync = ref.watch(savedAddressesProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.addressSelectTitle),
        actions: [
          // Capped (and ellipsised) so a very large system font on a narrow phone cannot push it off the bar.
          ConstrainedBox(
            constraints: BoxConstraints(
                maxWidth: MediaQuery.sizeOf(context).width * 0.42),
            child: TextButton(
              onPressed: () async {
                final created =
                    await context.push<SavedAddress>('/addresses/add');
                if (created != null && context.mounted) context.pop(created);
              },
              child: Text(l10n.addressAddNew,
                  maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
          ),
        ],
      ),
      body: addressesAsync.when(
        loading: () => const HatlyLoadingView(),
        error: (error, stackTrace) => HatlyStateView(
          icon: Icons.error_outline,
          title: l10n.somethingWentWrong,
          retryLabel: l10n.retry,
          onRetry: () => ref.invalidate(savedAddressesProvider),
        ),
        data: (addresses) {
          if (addresses.isEmpty) {
            return HatlyStateView(
              icon: Icons.location_off_outlined,
              title: l10n.addressNoneSavedYet,
              subtitle: l10n.addressAddNew,
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(HatlySpacing.md),
            itemCount: addresses.length,
            separatorBuilder: (context, index) =>
                const SizedBox(height: HatlySpacing.sm),
            itemBuilder: (context, index) {
              final address = addresses[index];
              final isDeleting = _deletingIds.contains(address.id);
              final p = context.palette;
              return HatlySurface(
                key: Key('address-tile-${address.id}'),
                // PD-009: an address that needs a delivery zone is completed first (the customer picks the zone), then
                // the completed address is returned — it is never returned half-usable, and no zone is guessed.
                onTap: () async {
                  if (!address.needsZoneSelection) {
                    context.pop(address);
                    return;
                  }
                  final completed = await context
                      .push<SavedAddress>('/addresses/add', extra: address);
                  if (!context.mounted) return;
                  ref.invalidate(savedAddressesProvider);
                  if (completed != null && !completed.needsZoneSelection) {
                    context.pop(completed);
                  }
                },
                semanticLabel: address.label?.isNotEmpty == true
                    ? '${address.label}, ${address.line1}'
                    : address.line1,
                child: Row(
                  children: [
                    Icon(Icons.location_on_outlined, color: p.textMuted),
                    const SizedBox(width: HatlySpacing.ms),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Wrap, not Row: with a large font on a narrow phone the "Default" badge moves under the name.
                          Wrap(
                            spacing: HatlySpacing.sm,
                            runSpacing: 4,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Text(
                                address.label?.isNotEmpty == true
                                    ? address.label!
                                    : address.line1,
                                style: context.type.title,
                              ),
                              if (address.isDefault) ...[
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: HatlySpacing.sm, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: p.accentSoft,
                                    borderRadius:
                                        BorderRadius.circular(HatlyRadius.chip),
                                  ),
                                  child: Text(l10n.checkoutDefaultAddress,
                                      style: context.type.caption
                                          .copyWith(color: p.link)),
                                ),
                              ],
                            ],
                          ),
                          if (address.label?.isNotEmpty == true)
                            Text(address.line1, style: context.type.small),
                          AddressAreaLines(address: address),
                        ],
                      ),
                    ),
                    // A nested IconButton has its own ink response,
                    // which consumes the tap before it can bubble up
                    // to HatlyCard's own onTap — confirmed standard
                    // Flutter gesture-disambiguation behavior, so
                    // neither edit nor delete ever accidentally
                    // triggers address selection.
                    IconButton(
                      icon: Icon(Icons.edit_outlined, color: p.textMuted),
                      tooltip: l10n.editAddressTitle,
                      onPressed: () async {
                        await context.push('/addresses/add', extra: address);
                        // Edit never returns a selection — refresh from
                        // the backend so any change appears in this
                        // list, using the same invalidation convention
                        // already used by create/delete.
                        if (context.mounted)
                          ref.invalidate(savedAddressesProvider);
                      },
                    ),
                    isDeleting
                        ? const SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : IconButton(
                            icon: Icon(Icons.delete_outline, color: p.urgent),
                            tooltip: l10n.addressDeleteAction,
                            onPressed: () => _confirmAndDelete(address),
                          ),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}
