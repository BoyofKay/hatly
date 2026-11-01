import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_primary_button.dart';
import '../../../addresses/domain/saved_address.dart';
import '../../../addresses/presentation/address_pin_picker.dart';
import '../../../addresses/presentation/widgets/saved_address_picker.dart';
import '../../domain/route_endpoint.dart';

/// What the customer decided in the endpoint sheet: a point of their own, or "use the service default" (clears their choice).
class RouteEndpointChoice {
  const RouteEndpointChoice.point(RouteEndpoint this.endpoint) : useDefault = false;
  const RouteEndpointChoice.defaultPoint()
      : endpoint = null,
        useDefault = true;

  final RouteEndpoint? endpoint;
  final bool useDefault;
}

/// Opens the sheet that lets the customer choose ONE end of the route: their current location or a point on the map, or one of their
/// saved addresses that has a pin — whichever fits; nothing is assumed (the home address is never pre-selected). [defaultEndpoint], when the
/// service has one configured, adds a "use the default" choice.
Future<RouteEndpointChoice?> showRouteEndpointSheet(
  BuildContext context, {
  required bool isOrigin,
  RouteEndpoint? current,
  RouteEndpoint? defaultEndpoint,
}) {
  return showModalBottomSheet<RouteEndpointChoice>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _RouteEndpointSheet(isOrigin: isOrigin, current: current, defaultEndpoint: defaultEndpoint),
  );
}

class _RouteEndpointSheet extends StatefulWidget {
  const _RouteEndpointSheet({required this.isOrigin, this.current, this.defaultEndpoint});

  final bool isOrigin;
  final RouteEndpoint? current;
  final RouteEndpoint? defaultEndpoint;

  @override
  State<_RouteEndpointSheet> createState() => _RouteEndpointSheetState();
}

class _RouteEndpointSheetState extends State<_RouteEndpointSheet> {
  final _name = TextEditingController();
  double? _lat;
  double? _lng;
  bool _fromCurrentLocation = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _confirmPoint(AppLocalizations l10n) {
    final lat = _lat;
    final lng = _lng;
    if (lat == null || lng == null) return;
    final typed = _name.text.trim();
    final label = typed.isNotEmpty
        ? typed
        : (_fromCurrentLocation ? l10n.routeCurrentLocationLabel : l10n.routeSelectedPointLabel);
    Navigator.of(context).pop(RouteEndpointChoice.point(
      RouteEndpoint(latitude: lat, longitude: lng, label: label, source: RouteEndpointSource.customer),
    ));
  }

  void _useSaved(SavedAddress a) {
    final lat = a.latitude;
    final lng = a.longitude;
    if (lat == null || lng == null) return;
    final label = (a.label?.isNotEmpty ?? false)
        ? a.label!
        : (a.line1.isNotEmpty ? a.line1 : gpsAddressText(lat, lng));
    Navigator.of(context).pop(RouteEndpointChoice.point(
      RouteEndpoint(latitude: lat, longitude: lng, label: label, source: RouteEndpointSource.customer),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final defaultEndpoint = widget.defaultEndpoint;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.all(HatlySpacing.md),
        children: [
          Text(
            widget.isOrigin ? l10n.routeSheetTitleOrigin : l10n.routeSheetTitleDestination,
            key: const Key('route-sheet-title'),
            style: context.type.title,
          ),
          const SizedBox(height: HatlySpacing.md),
          Text(l10n.routeSheetPointSection, style: context.type.small),
          const SizedBox(height: HatlySpacing.sm),
          AddressPinPicker(
            key: const Key('route-sheet-picker'),
            latitude: _lat,
            longitude: _lng,
            onChanged: (lat, lng) => setState(() {
              _lat = lat;
              _lng = lng;
              _fromCurrentLocation = true;
            }),
          ),
          if (_lat != null) ...[
            const SizedBox(height: HatlySpacing.sm),
            TextField(
              key: const Key('route-sheet-name'),
              controller: _name,
              maxLength: 120,
              decoration: InputDecoration(
                labelText: l10n.routeNameThisPlace,
                hintText: l10n.routeNameThisPlaceHint,
                counterText: '',
              ),
            ),
            const SizedBox(height: HatlySpacing.sm),
            HatlyPrimaryButton(
              key: const Key('route-sheet-confirm'),
              label: l10n.routeConfirmPoint,
              onPressed: () => _confirmPoint(l10n),
            ),
          ],
          const SizedBox(height: HatlySpacing.lg),
          Text(l10n.routeSheetSavedSection, style: context.type.small),
          const SizedBox(height: HatlySpacing.sm),
          SavedAddressPicker(
            key: const Key('route-sheet-saved'),
            selectedId: null,
            requirePin: true,
            onSelected: _useSaved,
          ),
          if (defaultEndpoint != null) ...[
            const SizedBox(height: HatlySpacing.lg),
            OutlinedButton(
              key: const Key('route-sheet-use-default'),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(HatlyTouch.minTarget)),
              onPressed: () => Navigator.of(context).pop(const RouteEndpointChoice.defaultPoint()),
              child: Text('${l10n.routeUseDefault}: ${defaultEndpoint.label}', textAlign: TextAlign.center),
            ),
          ],
        ],
      ),
    );
  }
}
