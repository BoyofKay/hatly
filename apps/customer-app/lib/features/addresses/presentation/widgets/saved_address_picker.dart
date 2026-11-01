import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_error_banner.dart';
import '../../../../shared_widgets/hatly_loading_view.dart';
import '../../data/addresses_providers.dart';
import '../../domain/saved_address.dart';

/// A dropdown of the customer's SAVED addresses — the very list ordinary checkout uses (`savedAddressesProvider`) — whose LAST
/// entry is "Add new address". Choosing it opens the normal Add Address screen (`/addresses/add`: the same form, validation,
/// zone selection and map/GPS pin as everywhere else); the address it saves is selected right away. Nothing here stores,
/// validates or duplicates an address.
///
/// [requirePin]: the caller needs COORDINATES (e.g. a Hatly Service pickup/destination). A saved address that has only a delivery
/// zone and no map pin is listed but cannot be chosen, and says why — it is never given invented coordinates.
class SavedAddressPicker extends ConsumerWidget {
  const SavedAddressPicker({
    super.key,
    required this.selectedId,
    required this.onSelected,
    this.requirePin = false,
  });

  final String? selectedId;
  final ValueChanged<SavedAddress> onSelected;
  final bool requirePin;

  static const _addNewValue = '__add_new_address__';

  bool _usable(SavedAddress a) =>
      !requirePin || (a.latitude != null && a.longitude != null);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final addressesAsync = ref.watch(savedAddressesProvider);

    return addressesAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: HatlySpacing.md),
        child: HatlyLoadingView(inline: true),
      ),
      error: (_, __) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          HatlyErrorBanner(message: l10n.somethingWentWrong),
          TextButton(
              onPressed: () => ref.invalidate(savedAddressesProvider),
              child: Text(l10n.retry)),
        ],
      ),
      data: (addresses) {
        Future<void> addNew() async {
          final created = await context.push<SavedAddress>('/addresses/add');
          ref.invalidate(savedAddressesProvider);
          if (created == null || !context.mounted) return;
          if (_usable(created)) {
            onSelected(created);
          } else {
            ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(l10n.addressPickerNeedsPin)));
          }
        }

        final current = addresses.any((a) => a.id == selectedId && _usable(a))
            ? selectedId
            : null;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            DropdownButtonFormField<String>(
              key: const Key('saved-address-dropdown'),
              initialValue: current,
              isExpanded: true,
              // Entries are two or three lines (label, address, "no map location"): let them size themselves.
              itemHeight: null,
              hint: Text(addresses.isEmpty
                  ? l10n.addressNoneSavedYet
                  : l10n.addressPickerHint),
              decoration: const InputDecoration(),
              // What the closed field shows: one line per entry (the open list shows the full two/three-line entries).
              selectedItemBuilder: (context) => [
                for (final a in addresses)
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: Text(
                        a.label?.isNotEmpty == true ? a.label! : a.line1,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                  ),
                const SizedBox.shrink(),
              ],
              items: [
                for (final a in addresses)
                  DropdownMenuItem<String>(
                    key: Key('saved-address-item-${a.id}'),
                    value: a.id,
                    enabled: _usable(a),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(a.label?.isNotEmpty == true ? a.label! : a.line1,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.type.body.copyWith(
                                color:
                                    _usable(a) ? p.textPrimary : p.textMuted)),
                        if (a.label?.isNotEmpty == true)
                          Text(a.line1,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: context.type.caption),
                        if (!_usable(a))
                          Text(l10n.addressPickerNoPin,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: context.type.caption
                                  .copyWith(color: p.urgent)),
                      ],
                    ),
                  ),
                // The LAST entry is always "add a new address".
                DropdownMenuItem<String>(
                  key: const Key('saved-address-add-new'),
                  value: _addNewValue,
                  child: Row(
                    children: [
                      Icon(Icons.add_location_alt_outlined, color: p.accent),
                      const SizedBox(width: HatlySpacing.sm),
                      Flexible(
                        child: Text(l10n.addressAddNew,
                            overflow: TextOverflow.ellipsis,
                            style: context.type.body.copyWith(
                                color: p.accent, fontWeight: FontWeight.w700)),
                      ),
                    ],
                  ),
                ),
              ],
              onChanged: (value) {
                if (value == null) return;
                if (value == _addNewValue) {
                  addNew();
                  return;
                }
                final chosen = addresses.firstWhere((a) => a.id == value);
                if (_usable(chosen)) onSelected(chosen);
              },
            ),
          ],
        );
      },
    );
  }
}
