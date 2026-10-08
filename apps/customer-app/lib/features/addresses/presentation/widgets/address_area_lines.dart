import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../domain/saved_address.dart';

/// The delivery area of a saved address ("بلبيس — أبو نصيب"), or — for an address that still needs one (saved before zones,
/// or whose zone was deactivated) — a clear prompt to choose it. Never shows an internal id.
class AddressAreaLines extends StatelessWidget {
  const AddressAreaLines({super.key, required this.address});

  final SavedAddress address;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final zone = address.deliveryZone;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (zone != null && !address.needsZoneSelection)
          Text(zone.areaLabel(arabic), key: Key('address-area-${address.id}'), style: context.type.caption)
        else if (address.city?.isNotEmpty == true || address.governorate?.isNotEmpty == true)
          Text(
            [
              if (address.city?.isNotEmpty == true) address.city!,
              if (address.governorate?.isNotEmpty == true) address.governorate!,
            ].join('، '),
            style: context.type.caption,
          ),
        if (address.needsZoneSelection)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Row(
              key: Key('address-needs-zone-${address.id}'),
              children: [
                Icon(Icons.info_outline, size: 14, color: p.urgent),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    address.zoneStatus == AddressZoneStatus.unavailable
                        ? l10n.addressZoneUnavailableBanner
                        : l10n.addressZoneMissingBanner,
                    style: context.type.caption.copyWith(color: p.urgent),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
