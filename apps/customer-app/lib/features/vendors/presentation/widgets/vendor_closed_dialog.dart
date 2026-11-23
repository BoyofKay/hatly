import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';

/// Owner request 2026-11-23: a store outside its working hours (or switched off) shows "[store] is closed" with two choices —
/// Close, or View menu (browse only; checkout refuses closed stores on the server anyway). [onViewMenu] null hides that button
/// (e.g. the customer is already on the menu).
Future<void> showVendorClosedDialog(
  BuildContext context, {
  required String vendorName,
  String? hoursLabel,
  VoidCallback? onViewMenu,
}) {
  final l10n = AppLocalizations.of(context);
  return showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      key: const Key('vendor-closed-dialog'),
      icon: const Icon(Icons.storefront_outlined),
      title: Text(l10n.vendorClosedDialogTitle(vendorName)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l10n.vendorClosedDialogBody),
          if (hoursLabel != null) ...[
            const SizedBox(height: 12),
            Row(children: [
              const Icon(Icons.schedule_rounded, size: 18),
              const SizedBox(width: 6),
              Flexible(child: Text(l10n.vendorHoursToday(hoursLabel))),
            ]),
          ],
        ],
      ),
      actions: [
        TextButton(
          key: const Key('vendor-closed-dialog-close'),
          onPressed: () => Navigator.of(ctx).pop(),
          child: Text(l10n.vendorClosedDialogClose),
        ),
        if (onViewMenu != null)
          FilledButton(
            key: const Key('vendor-closed-dialog-view-menu'),
            onPressed: () {
              Navigator.of(ctx).pop();
              onViewMenu();
            },
            child: Text(l10n.vendorClosedDialogViewMenu),
          ),
      ],
    ),
  );
}
