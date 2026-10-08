import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_error_banner.dart';
import '../../../../shared_widgets/hatly_loading_view.dart';
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
    // Polish pass: was a literal `BorderRadius.circular(20)`, duplicating
    // (and now diverging in intent from) the theme's own
    // `bottomSheetTheme.shape` (`HatlyRadius.bottomSheetTop` = 20) — leaving
    // `shape` unset lets every bottom sheet in the app share one definition.
    builder: (sheetContext) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(HatlySpacing.md),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l10n.selectAddressTitle, style: sheetContext.type.title),
              const SizedBox(height: HatlySpacing.ms),
              Consumer(
                builder: (context, sheetRef, _) {
                  final addressesAsync = sheetRef.watch(savedAddressesProvider);
                  return addressesAsync.when(
                    loading: () => const Padding(
                      padding: EdgeInsets.symmetric(vertical: HatlySpacing.lg),
                      child: HatlyLoadingView(inline: true),
                    ),
                    error: (error, stackTrace) => Padding(
                      padding:
                          const EdgeInsets.symmetric(vertical: HatlySpacing.sm),
                      child: HatlyErrorBanner(message: l10n.somethingWentWrong),
                    ),
                    data: (addresses) {
                      if (addresses.isEmpty) {
                        return Padding(
                          padding: const EdgeInsets.symmetric(
                              vertical: HatlySpacing.sm),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(l10n.addressNoneSavedYet),
                              const SizedBox(height: HatlySpacing.ms),
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
                              title: Text(
                                address.label?.isNotEmpty == true
                                    ? address.label!
                                    : address.line1,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: address.label?.isNotEmpty == true
                                  ? Text(
                                      address.line1,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    )
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
