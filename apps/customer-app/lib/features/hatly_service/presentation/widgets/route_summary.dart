import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../domain/route_endpoint.dart';

/// The Hatly / Wasally route, origin → destination, as two labelled rows. Used on the request screen (editable), the checkout (read
/// only, exactly what the server resolved) and the order details (read only, what was frozen). A missing end says so — nothing is guessed.
class RouteSummary extends StatelessWidget {
  const RouteSummary({
    super.key,
    required this.origin,
    required this.destination,
    this.onChangeOrigin,
    this.onChangeDestination,
    this.originHint,
    this.destinationHint,
  });

  /// Null while there is nothing to show (no choice and no default).
  final RouteEndpoint? origin;
  final RouteEndpoint? destination;

  /// Null = read only.
  final VoidCallback? onChangeOrigin;
  final VoidCallback? onChangeDestination;

  /// Shown instead of "not set" when an end is missing (e.g. "choose where to pick up").
  final String? originHint;
  final String? destinationHint;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        RouteEndpointRow(
          rowKey: 'route-origin',
          title: l10n.routeFromLabel,
          icon: Icons.trip_origin,
          endpoint: origin,
          hint: originHint,
          onChange: onChangeOrigin,
        ),
        Padding(
          padding: const EdgeInsetsDirectional.only(start: 9),
          child: SizedBox(
            height: 14,
            child: VerticalDivider(width: 2, thickness: 2, color: p.border),
          ),
        ),
        RouteEndpointRow(
          rowKey: 'route-destination',
          title: l10n.routeToLabel,
          icon: Icons.place_outlined,
          endpoint: destination,
          hint: destinationHint,
          onChange: onChangeDestination,
        ),
      ],
    );
  }
}

class RouteEndpointRow extends StatelessWidget {
  const RouteEndpointRow({
    super.key,
    required this.rowKey,
    required this.title,
    required this.icon,
    required this.endpoint,
    this.hint,
    this.onChange,
  });

  final String rowKey;
  final String title;
  final IconData icon;
  final RouteEndpoint? endpoint;
  final String? hint;
  final VoidCallback? onChange;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final e = endpoint;
    final text = e == null
        ? (hint ?? l10n.routeNotSet)
        : (e.label.isNotEmpty ? e.label : l10n.routeSelectedPointLabel);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Icon(icon, size: 20, color: e == null ? p.urgent : p.accent),
        const SizedBox(width: HatlySpacing.sm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(title, style: context.type.caption),
                  if (e != null) ...[
                    const SizedBox(width: HatlySpacing.xs),
                    Flexible(
                      child: Container(
                        key: Key('$rowKey-badge'),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: e.isDefault ? p.surface : p.accentSoft,
                          border: Border.all(
                              color: e.isDefault ? p.border : p.accent),
                          borderRadius: BorderRadius.circular(HatlyRadius.chip),
                        ),
                        child: Text(
                          e.isDefault
                              ? l10n.routeBadgeDefault
                              : l10n.routeBadgeChosen,
                          style: context.type.caption,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              Text(
                text,
                key: Key('$rowKey-label'),
                style: context.type.body.copyWith(
                  fontWeight: FontWeight.w600,
                  color: e == null ? p.urgent : null,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
        if (onChange != null)
          TextButton(
            key: Key('$rowKey-change'),
            style: TextButton.styleFrom(minimumSize: const Size(0, 40)),
            onPressed: onChange,
            child: Text(e == null ? l10n.routeChoose : l10n.routeChange),
          ),
      ],
    );
  }
}
