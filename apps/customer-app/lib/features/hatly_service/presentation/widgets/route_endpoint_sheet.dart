import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../addresses/data/addresses_providers.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_primary_button.dart';
import '../../../addresses/domain/saved_address.dart';
import '../../../addresses/presentation/address_pin_picker.dart';
import '../../../addresses/presentation/widgets/saved_address_picker.dart';
import '../../domain/route_endpoint.dart';

/// What the customer decided in the endpoint sheet: a point of their own, or "use the service default" (clears their choice).
class RouteEndpointChoice {
  const RouteEndpointChoice.point(RouteEndpoint this.endpoint)
      : useDefault = false;
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
    builder: (_) => _RouteEndpointSheet(
        isOrigin: isOrigin, current: current, defaultEndpoint: defaultEndpoint),
  );
}

class _RouteEndpointSheet extends ConsumerStatefulWidget {
  const _RouteEndpointSheet(
      {required this.isOrigin, this.current, this.defaultEndpoint});

  final bool isOrigin;
  final RouteEndpoint? current;
  final RouteEndpoint? defaultEndpoint;

  @override
  ConsumerState<_RouteEndpointSheet> createState() =>
      _RouteEndpointSheetState();
}

class _RouteEndpointSheetState extends ConsumerState<_RouteEndpointSheet> {
  final _name = TextEditingController();
  final _link = TextEditingController();
  bool _readingLink = false;
  String? _linkError;
  double? _lat;
  double? _lng;
  bool _fromCurrentLocation = false;

  @override
  void dispose() {
    _name.dispose();
    _link.dispose();
    super.dispose();
  }

  void _confirmPoint(AppLocalizations l10n) {
    final lat = _lat;
    final lng = _lng;
    if (lat == null || lng == null) return;
    final typed = _name.text.trim();
    final label = typed.isNotEmpty
        ? typed
        : (_fromCurrentLocation
            ? l10n.routeCurrentLocationLabel
            : l10n.routeSelectedPointLabel);
    Navigator.of(context).pop(RouteEndpointChoice.point(
      RouteEndpoint(
          latitude: lat,
          longitude: lng,
          label: label,
          source: RouteEndpointSource.customer),
    ));
  }

  /// Owner request 2026-11-27: choose the place in Google Maps / Apple Maps and paste its link here (works while the in-app map is off).
  Future<void> _readLink(AppLocalizations l10n) async {
    final url = _link.text.trim();
    if (url.isEmpty) return;
    setState(() {
      _readingLink = true;
      _linkError = null;
    });
    try {
      final point = await ref.read(addressesApiProvider).pointFromMapsLink(url);
      if (!mounted) return;
      setState(() {
        _readingLink = false;
        if (point == null) {
          _linkError = l10n.routeMapLinkNoLocation;
        } else {
          _lat = point.latitude;
          _lng = point.longitude;
          _fromCurrentLocation = false;
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _readingLink = false;
        _linkError = l10n.routeMapLinkNoLocation;
      });
    }
  }

  Future<void> _openMapsApp() async {
    final apple = Theme.of(context).platform == TargetPlatform.iOS;
    final uri = Uri.parse(
        apple ? 'https://maps.apple.com/' : 'https://www.google.com/maps');
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  void _useSaved(SavedAddress a) {
    final lat = a.latitude;
    final lng = a.longitude;
    if (lat == null || lng == null) return;
    final label = (a.label?.isNotEmpty ?? false)
        ? a.label!
        : (a.line1.isNotEmpty ? a.line1 : gpsAddressText(lat, lng));
    Navigator.of(context).pop(RouteEndpointChoice.point(
      RouteEndpoint(
          latitude: lat,
          longitude: lng,
          label: label,
          source: RouteEndpointSource.customer),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final defaultEndpoint = widget.defaultEndpoint;
    return Padding(
      padding:
          EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.all(HatlySpacing.md),
        children: [
          Text(
            widget.isOrigin
                ? l10n.routeSheetTitleOrigin
                : l10n.routeSheetTitleDestination,
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
          const SizedBox(height: HatlySpacing.md),
          Text(l10n.routeMapLinkSection, style: context.type.small),
          const SizedBox(height: HatlySpacing.xs),
          Text(l10n.routeMapLinkHelp, style: context.type.caption),
          const SizedBox(height: HatlySpacing.sm),
          Row(children: [
            Expanded(
              child: TextField(
                key: const Key('route-sheet-link'),
                controller: _link,
                keyboardType: TextInputType.url,
                textDirection: TextDirection.ltr,
                decoration: InputDecoration(
                    hintText: 'https://maps.app.goo.gl/…',
                    errorText: _linkError),
                onSubmitted: (_) => _readLink(l10n),
              ),
            ),
            const SizedBox(width: HatlySpacing.sm),
            _readingLink
                ? const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : TextButton(
                    key: const Key('route-sheet-link-use'),
                    onPressed: () => _readLink(l10n),
                    child: Text(l10n.routeMapLinkUse)),
          ]),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              key: const Key('route-sheet-open-maps'),
              onPressed: _openMapsApp,
              icon: const Icon(Icons.map_outlined),
              label: Text(l10n.routeOpenMapsApp),
            ),
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
              style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(HatlyTouch.minTarget)),
              onPressed: () => Navigator.of(context)
                  .pop(const RouteEndpointChoice.defaultPoint()),
              child: Text('${l10n.routeUseDefault}: ${defaultEndpoint.label}',
                  textAlign: TextAlign.center),
            ),
          ],
        ],
      ),
    );
  }
}
