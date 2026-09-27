import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../addresses/data/addresses_providers.dart';
import '../../data/home_address_provider.dart';

/// LAUNCH TRACK L1-A. Opened from HomeLocationBar — now lists the
/// real Saved Addresses (`savedAddressesProvider`, the exact same
/// source Checkout already uses) instead of the two fixture options.
/// Tapping one sets `homeSelectedAddressIdProvider` (a thin override,
/// not a second address store). When there are zero saved addresses,
/// offers a direct path to the existing real "Add Address" screen —
/// no fake address is ever offered as a selectable option.
Future<void> showAddressSelectionSheet(BuildContext context, WidgetRef ref) {
  final l10n = AppLocalizations.of(context);

  return showModalBottomSheet(
    context: context,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (sheetContext) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l10n.selectAddressTitle,
                  style: const TextStyle(
                      fontSize: 17, fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              Consumer(
                builder: (context, sheetRef, _) {
                  final addressesAsync = sheetRef.watch(savedAddressesProvider);
                  return addressesAsync.when(
                    loading: () => const Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                    error: (error, stackTrace) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Text(l10n.somethingWentWrong),
                    ),
                    data: (addresses) {
                      if (addresses.isEmpty) {
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(l10n.addressNoneSavedYet),
                              const SizedBox(height: 12),
                              FilledButton(
                                onPressed: () {
                                  Navigator.of(sheetContext).pop();
                                  context.push('/addresses/add');
                                },
                                child: Text(l10n.addressAddNew),
                              ),
                            ],
                          ),
                        );
                      }
                      return Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          for (final address in addresses)
                            ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: const Icon(Icons.location_on_outlined),
                              title: Text(address.label?.isNotEmpty == true
                                  ? address.label!
                                  : address.line1),
                              subtitle: address.label?.isNotEmpty == true
                                  ? Text(address.line1)
                                  : null,
                              onTap: () {
                                ref
                                    .read(
                                        homeSelectedAddressIdProvider.notifier)
                                    .state = address.id;
                                Navigator.of(sheetContext).pop();
                              },
                            ),
                        ],
                      );
                    },
                  );
                },
              ),
            ],
          ),
        ),
      );
    },
  );
}
