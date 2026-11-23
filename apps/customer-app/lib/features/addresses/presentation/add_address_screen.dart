import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../shared_widgets/hatly_key_value_row.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../data/addresses_providers.dart';
import '../domain/delivery_zone.dart';
import '../domain/saved_address.dart';
import 'address_pin_picker.dart';

/// Create / edit a saved address — through ONE of two ALTERNATIVE methods, never both on one form:
///
///  - GPS: the customer shares their current location; the coordinates ARE the address (no area, no typed text). Location permission
///    is asked only after this method is chosen. The server checks coverage and prices delivery by road distance.
///  - MANUAL: the customer picks the delivery area (Governorate → City → Area, from `GET /delivery-zones` — never hardcoded) and writes
///    the detailed address. No location is requested and no coordinates are collected; the area's fixed fee is the base fee.
///
/// The first screen offers the two methods; after choosing, only that method's fields are shown. "Change address method" explains what
/// will be discarded before clearing it. Editing preserves the saved method. Against a backend that predates the methods the screen
/// shows the single legacy (manual) form and sends no mode. The server stays authoritative — checkout re-quotes whatever is saved.
///
/// When [existing] is supplied the screen edits it (`PATCH /addresses/:id`); otherwise it creates a new one and pops it.
class AddAddressScreen extends ConsumerStatefulWidget {
  const AddAddressScreen({super.key, this.existing, this.mapEnabled});

  final SavedAddress? existing;

  /// Test hook; defaults to the build-time flag.
  final bool? mapEnabled;

  @override
  ConsumerState<AddAddressScreen> createState() => _AddAddressScreenState();
}

class _AddAddressScreenState extends ConsumerState<AddAddressScreen> {
  final _label = TextEditingController();
  final _line1 = TextEditingController();
  final _building = TextEditingController();
  final _floor = TextEditingController();
  final _apartment = TextEditingController();
  final _landmark = TextEditingController();
  final _instructions = TextEditingController();

  /// The chosen method; null until the customer chooses (the first screen).
  AddressMode? _mode;

  String? _governorate;
  String? _city;
  String? _parentZoneAr;
  String? _zoneId;
  bool _zoneInitialized = false;

  /// True once the customer discarded the saved area (changed method): an edited address's old zone is then not preselected again.
  bool _zoneDiscarded = false;

  /// True while the zone was chosen for the customer because it is the ONLY active zone of the selected city.
  bool _zoneAutoSelected = false;

  double? _latitude;
  double? _longitude;
  /// The address the map provider resolved for the GPS pin (assistive; null when Maps are off or nothing was found — never asked of the customer).
  String? _resolvedAddress;
  int _resolveSeq = 0;
  bool _isDefault = false;
  bool _isSaving = false;
  bool _showErrors = false;
  String? _error;

  bool get _isEditing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      // The saved method is preserved. A legacy address (saved before the two methods) is edited as MANUAL — the original area + text
      // form — and keeps no coordinates unless the customer explicitly changes the method to GPS.
      _mode = e.mode ?? AddressMode.manual;
      _label.text = e.label ?? '';
      _instructions.text = e.instructions ?? '';
      _isDefault = e.isDefault;
      if (_mode == AddressMode.gps) {
        _latitude = e.latitude;
        _longitude = e.longitude;
        _resolvedAddress = e.formattedAddress;
      } else {
        _line1.text = e.line1; // a MANUAL or legacy address always has written text (a GPS address never reaches this branch)
        _building.text = e.buildingNumber ?? '';
        _floor.text = e.floor ?? '';
        _apartment.text = e.apartment ?? '';
        _landmark.text = e.landmark ?? '';
      }
    }
  }

  @override
  void dispose() {
    for (final c in [_label, _line1, _building, _floor, _apartment, _landmark, _instructions]) {
      c.dispose();
    }
    super.dispose();
  }

  /// Once the zones arrive, an edited address's own zone is preselected — but only if it is still offered. A zone that is
  /// gone (or an address that never had one) leaves the choice to the customer; nothing is guessed from coordinates.
  /// A NEW address gets the data-driven shortcuts of [_applySingleChoices].
  void _initZoneSelection(List<DeliveryZone> zones) {
    if (_zoneInitialized) return;
    _zoneInitialized = true;
    final existing = _zoneDiscarded ? null : widget.existing;
    final current = existing?.deliveryZone;
    if (existing == null) {
      _applySingleChoices(zones);
      return;
    }
    if (current == null) {
      // A legacy address: only the place is narrowed; the zone itself is an explicit customer choice (it is never assigned
      // to an old address on the customer's behalf, even when its city has a single zone).
      _applySingleChoices(zones, includeZone: false);
      return;
    }
    _governorate = current.governorateAr;
    _city = current.cityAr;
    _parentZoneAr = current.parentZoneKey;
    if (zones.any((z) => z.id == current.id)) _zoneId = current.id;
  }

  /// Data-driven, never hardcoded: when the backend offers exactly ONE governorate / city / active zone for the current
  /// selection, it is selected for the customer (shown as selected, still changeable). With several, the customer chooses.
  void _applySingleChoices(List<DeliveryZone> zones, {bool includeZone = true}) {
    final governorates = zones.map((z) => z.governorateAr).toSet();
    if (_governorate == null && governorates.length == 1) _governorate = governorates.first;
    final cities = zones.where((z) => z.governorateAr == _governorate).map((z) => z.cityAr).toSet();
    if (_city == null && cities.length == 1) _city = cities.first;
    if (_city == null) return;
    final cityZones = zones.where((z) => z.governorateAr == _governorate && z.cityAr == _city).toList();
    final parents = cityZones.map((z) => z.parentZoneKey).toSet();
    if (_parentZoneAr == null && parents.length == 1) _parentZoneAr = parents.first;
    if (!includeZone || _zoneId != null || _parentZoneAr == null) return;
    final children = cityZones.where((z) => z.parentZoneKey == _parentZoneAr).toList();
    if (children.length == 1) {
      _zoneId = children.single.id;
      _zoneAutoSelected = true;
    }
  }


  /// The GPS method got a point: the coordinates are the whole address. Nothing else is asked.
  void _onGpsPoint(double latitude, double longitude) {
    final seq = ++_resolveSeq;
    setState(() {
      _latitude = latitude;
      _longitude = longitude;
      _resolvedAddress = null;
      _error = null;
    });
    _resolveAddress(seq, latitude, longitude);
  }

  /// Assistive reverse geocoding: shows what the map provider says is at the pin so the customer never has to type an address that is
  /// already known. Silent when unavailable (Maps off, no result, offline) — the coordinates remain the address and saving is never blocked.
  Future<void> _resolveAddress(int seq, double latitude, double longitude) async {
    try {
      final text = (await ref.read(addressesApiProvider).reverseGeocode(latitude, longitude))?.trim();
      if (!mounted || seq != _resolveSeq || text == null || text.isEmpty) return;
      setState(() => _resolvedAddress = text.length > 500 ? text.substring(0, 500) : text);
    } catch (_) {
      // Assistive only.
    }
  }

  /// "Change address method": says what will be discarded, then clears exactly the fields the other method does not use.
  Future<void> _changeMethod() async {
    final l10n = AppLocalizations.of(context);
    final discards = _mode == AddressMode.gps ? l10n.addressChangeMethodDiscardsGps : l10n.addressChangeMethodDiscardsManual;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        key: const Key('address-change-method-dialog'),
        title: Text(l10n.addressChangeMethodTitle),
        content: Text(discards, key: const Key('address-change-method-discards')),
        actions: [
          TextButton(key: const Key('address-change-method-cancel'), onPressed: () => Navigator.of(context).pop(false), child: Text(l10n.cancel)),
          TextButton(key: const Key('address-change-method-confirm'), onPressed: () => Navigator.of(context).pop(true), child: Text(l10n.addressChangeMethodConfirm)),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      if (_mode == AddressMode.gps) {
        _latitude = null;
        _longitude = null;
        _resolvedAddress = null;
        _resolveSeq++;
      } else {
        _governorate = null;
        _city = null;
        _parentZoneAr = null;
        _zoneId = null;
        _zoneAutoSelected = false;
        _zoneInitialized = false;
        _zoneDiscarded = true;
        for (final c in [_line1, _building, _floor, _apartment, _landmark]) {
          c.clear();
        }
      }
      _mode = null;
      _error = null;
      _showErrors = false;
    });
  }

  String _errorMessage(AppLocalizations l10n, Object error) {
    if (error is ApiException) {
      switch (error.businessCode) {
        case 'DELIVERY_ZONE_UNAVAILABLE':
          return l10n.checkoutAddressZoneUnavailable;
        case 'ADDRESS_ZONE_REQUIRED':
          return l10n.addressZoneRequired;
        case 'ADDRESS_OUT_OF_SERVICE_AREA':
          return l10n.addressGpsOutsideCoverage;
        case 'INVALID_DELIVERY_LOCATION':
          return l10n.addressGpsInvalidLocation;
        case 'DISTANCE_PRICING_UNAVAILABLE':
          return l10n.addressMethodGpsUnavailable;
        case 'INVALID_DELIVERY_ADDRESS':
          return l10n.checkoutBlockerInvalidAddress;
      }
      if (error.code == 'NETWORK_ERROR') return l10n.errorNetwork;
    }
    return l10n.somethingWentWrong;
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context);
    setState(() => _showErrors = true);
    final includeMode = ref.read(addressCapabilitiesProvider).maybeWhen(data: (c) => c.supportsModes, orElse: () => true);
    final AddressInput input;
    if (_mode == AddressMode.gps) {
      if (_latitude == null || _longitude == null) return;
      input = AddressInput.gps(
        label: _label.text,
        latitude: _latitude!,
        longitude: _longitude!,
        formattedAddress: _resolvedAddress,
        instructions: _instructions.text,
        isDefault: _isDefault ? true : null,
      );
    } else {
      if (_zoneId == null || _line1.text.trim().isEmpty) return;
      input = AddressInput.manual(
        label: _label.text,
        line1: _line1.text.trim(),
        deliveryZoneId: _zoneId!,
        instructions: _instructions.text,
        buildingNumber: _building.text,
        floor: _floor.text,
        apartment: _apartment.text,
        landmark: _landmark.text,
        isDefault: _isDefault ? true : null,
        includeMode: includeMode,
      );
    }
    setState(() {
      _isSaving = true;
      _error = null;
    });
    try {
      final api = ref.read(addressesApiProvider);
      final saved = _isEditing ? await api.updateAddress(widget.existing!.id, input) : await api.createAddress(input);
      ref.invalidate(savedAddressesProvider);
      if (mounted) context.pop(saved);
    } catch (error) {
      if (mounted) setState(() => _error = _errorMessage(l10n, error));
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Widget _field(TextEditingController controller, String label,
      {Key? key, int maxLines = 1, int? maxLength, String? errorText, String? hint, TextInputType? keyboardType}) {
    return TextField(
      key: key,
      controller: controller,
      maxLines: maxLines,
      maxLength: maxLength,
      keyboardType: keyboardType,
      textInputAction: maxLines > 1 ? TextInputAction.newline : TextInputAction.next,
      decoration: InputDecoration(labelText: label, hintText: hint, errorText: errorText, counterText: ''),
    );
  }

  Widget _dropdown<T>({
    required Key key,
    required String label,
    required T? value,
    required List<DropdownMenuItem<T>> items,
    required ValueChanged<T?> onChanged,
    String? errorText,
  }) {
    return DropdownButtonFormField<T>(
      key: key,
      // Reset the field's internal state whenever the available choices change (e.g. another city was picked).
      initialValue: items.any((i) => i.value == value) ? value : null,
      isExpanded: true,
      items: items,
      onChanged: onChanged,
      decoration: InputDecoration(labelText: label, errorText: errorText),
    );
  }

  Widget _zoneSection(BuildContext context, AppLocalizations l10n) {
    final p = context.palette;
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final zonesAsync = ref.watch(deliveryZonesProvider);
    final existing = widget.existing;

    return HatlySection(
      title: l10n.addressZoneSection,
      child: zonesAsync.when(
        loading: () => const Padding(
          padding: EdgeInsets.all(HatlySpacing.md),
          child: Center(child: CircularProgressIndicator(key: Key('address-zones-loading'))),
        ),
        error: (_, __) => HatlySurface(
          key: const Key('address-zones-error'),
          child: Row(
            children: [
              Icon(Icons.error_outline, color: p.urgent),
              const SizedBox(width: HatlySpacing.ms),
              Expanded(child: Text(l10n.addressZonesLoadError, style: context.type.small)),
              TextButton(
                key: const Key('address-zones-retry'),
                onPressed: () => ref.invalidate(deliveryZonesProvider),
                child: Text(l10n.retry),
              ),
            ],
          ),
        ),
        data: (zones) {
          _initZoneSelection(zones);
          if (zones.isEmpty) {
            return Text(l10n.addressZonesEmpty, key: const Key('address-zones-empty'), style: context.type.small);
          }
          // One option per governorate / city (by their Arabic name, the canonical key), labelled in the app's language.
          final governorates = <String, DeliveryZone>{for (final z in zones) z.governorateAr: z};
          final cities = <String, DeliveryZone>{
            for (final z in zones.where((z) => z.governorateAr == _governorate)) z.cityAr: z,
          };
          final cityZones = zones.where((z) => z.governorateAr == _governorate && z.cityAr == _city).toList();
          final parents = <String, DeliveryZone>{
            for (final z in cityZones) z.parentZoneKey: z,
          };
          final areaZones = cityZones.where((z) => z.parentZoneKey == _parentZoneAr).toList();
          DeliveryZone? selected;
          for (final z in areaZones) {
            if (z.id == _zoneId) selected = z;
          }
          final zoneMissing = _showErrors && _zoneId == null;

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (existing != null && existing.needsZoneSelection && _zoneId == null) ...[
                HatlySurface(
                  key: const Key('address-zone-banner'),
                  borderColor: p.urgent,
                  child: Row(
                    children: [
                      Icon(Icons.info_outline, color: p.urgent),
                      const SizedBox(width: HatlySpacing.ms),
                      Expanded(
                        child: Text(
                          existing.zoneStatus == AddressZoneStatus.unavailable
                              ? l10n.addressZoneUnavailableBanner
                              : l10n.addressZoneMissingBanner,
                          style: context.type.small,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: HatlySpacing.ms),
              ],
              Text(l10n.addressZoneHelp, key: const Key('address-zone-help'), style: context.type.small.copyWith(color: p.textMuted)),
              const SizedBox(height: HatlySpacing.ms),
              _dropdown<String>(
                key: const Key('address-governorate'),
                label: l10n.addressGovernorateLabel,
                value: _governorate,
                items: [
                  for (final e in governorates.entries)
                    DropdownMenuItem(value: e.key, child: Text(e.value.displayGovernorate(arabic))),
                ],
                onChanged: (v) => setState(() {
                  _governorate = v;
                  _city = null;
                  _parentZoneAr = null;
                  _zoneId = null;
                  _zoneAutoSelected = false;
                  _applySingleChoices(zones);
                }),
              ),
              const SizedBox(height: HatlySpacing.ms),
              _dropdown<String>(
                key: ValueKey('address-city-$_governorate'),
                label: l10n.addressCityLabel,
                value: _city,
                items: [
                  for (final e in cities.entries) DropdownMenuItem(value: e.key, child: Text(e.value.displayCity(arabic))),
                ],
                onChanged: (v) => setState(() {
                  _city = v;
                  _parentZoneAr = null;
                  _zoneId = null;
                  _zoneAutoSelected = false;
                  _applySingleChoices(zones);
                }),
              ),
              const SizedBox(height: HatlySpacing.ms),
              _dropdown<String>(
                key: ValueKey('address-parent-zone-$_governorate-$_city'),
                label: l10n.addressZoneLabel,
                value: _parentZoneAr,
                items: [
                  for (final e in parents.entries)
                    DropdownMenuItem(value: e.key, child: Text(e.value.displayZone(arabic))),
                ],
                onChanged: (v) => setState(() {
                  _parentZoneAr = v;
                  _zoneId = null;
                  _zoneAutoSelected = false;
                  _applySingleChoices(zones);
                }),
              ),
              const SizedBox(height: HatlySpacing.ms),
              _dropdown<String>(
                key: ValueKey('address-zone-$_governorate-$_city-$_parentZoneAr'),
                label: arabic ? 'الحي / القرية' : 'Neighborhood / Village',
                value: _zoneId,
                errorText: zoneMissing ? l10n.addressZoneRequired : null,
                items: [
                  for (final z in areaZones)
                    DropdownMenuItem(value: z.id, key: Key('address-zone-option-${z.id}'), child: Text(z.displayName(arabic))),
                ],
                onChanged: (v) => setState(() {
                  _zoneId = v;
                  _zoneAutoSelected = false;
                }),
              ),
              if (_city != null && cityZones.isEmpty) ...[
                const SizedBox(height: HatlySpacing.sm),
                Text(l10n.addressCityNoZones,
                    key: const Key('address-city-no-zones'), style: context.type.small.copyWith(color: p.urgent)),
              ],
              if (_zoneAutoSelected && selected != null) ...[
                const SizedBox(height: HatlySpacing.sm),
                Row(
                  key: const Key('address-zone-auto-selected'),
                  children: [
                    Icon(Icons.check_circle_outline, size: 16, color: p.link),
                    const SizedBox(width: HatlySpacing.xs),
                    Expanded(child: Text(l10n.addressZoneAutoSelected, style: context.type.small)),
                  ],
                ),
              ],
              if (selected?.deliveryFeeMinor != null) ...[
                const SizedBox(height: HatlySpacing.sm),
                Text(
                  l10n.addressZoneFeeHint(formatMinorUnits(selected!.deliveryFeeMinor!, context)),
                  key: const Key('address-zone-fee'),
                  style: context.type.small,
                ),
              ],
            ],
          );
        },
      ),
    );
  }


  // ------------------------------------------------------------------------------------------------ first screen: the two methods

  Widget _methodCard({
    required Key key,
    required IconData icon,
    required String title,
    required String hint,
    required bool enabled,
    String? disabledNote,
    String disabledNoteKey = 'address-method-unavailable',
    required VoidCallback onTap,
  }) {
    final p = context.palette;
    return Opacity(
      opacity: enabled ? 1 : 0.55,
      child: InkWell(
        key: key,
        borderRadius: BorderRadius.circular(HatlyRadius.chip),
        onTap: enabled ? onTap : null,
        child: HatlySurface(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 32, color: enabled ? p.link : p.textMuted),
              const SizedBox(width: HatlySpacing.ms),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: context.type.title),
                    const SizedBox(height: HatlySpacing.xs),
                    Text(hint, style: context.type.small.copyWith(color: p.textMuted)),
                    if (disabledNote != null) ...[
                      const SizedBox(height: HatlySpacing.xs),
                      Text(disabledNote, key: Key(disabledNoteKey), style: context.type.small.copyWith(color: p.urgent)),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _methodChooser(AppLocalizations l10n, AsyncValue<AddressCapabilities> capabilities) {
    final caps = capabilities.maybeWhen(data: (c) => c, orElse: () => null);
    final loading = capabilities.isLoading;
    final gpsEnabled = caps?.gpsAvailable == true;
    return Column(
      key: const Key('address-method-chooser'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.addressMethodTitle, style: context.type.title),
        const SizedBox(height: HatlySpacing.xs),
        Text(l10n.addressMethodSubtitle, style: context.type.small.copyWith(color: context.palette.textMuted)),
        const SizedBox(height: HatlySpacing.md),
        _methodCard(
          key: const Key('address-method-gps'),
          icon: Icons.my_location,
          title: l10n.addressMethodGpsTitle,
          hint: l10n.addressMethodGpsHint,
          enabled: gpsEnabled,
          disabledNote: loading ? l10n.addressMethodsLoading : (gpsEnabled ? null : l10n.addressMethodGpsUnavailable),
          disabledNoteKey: 'address-method-gps-unavailable',
          onTap: () => setState(() {
            _mode = AddressMode.gps;
            _error = null;
            _showErrors = false;
          }),
        ),
        const SizedBox(height: HatlySpacing.ms),
        _methodCard(
          key: const Key('address-method-manual'),
          icon: Icons.edit_location_alt_outlined,
          title: l10n.addressMethodManualTitle,
          hint: l10n.addressMethodManualHint,
          enabled: true,
          onTap: () => setState(() {
            _mode = AddressMode.manual;
            _error = null;
            _showErrors = false;
          }),
        ),
      ],
    );
  }

  Widget _methodHeader(AppLocalizations l10n, {required bool canChange}) {
    final p = context.palette;
    final gps = _mode == AddressMode.gps;
    return Row(
      key: const Key('address-method-header'),
      children: [
        Icon(gps ? Icons.my_location : Icons.edit_location_alt_outlined, size: 18, color: p.link),
        const SizedBox(width: HatlySpacing.xs),
        Expanded(child: Text(gps ? l10n.addressGpsJourneyBadge : l10n.addressManualJourneyBadge, style: context.type.caption)),
        if (canChange)
          Flexible(
            // The app theme makes buttons full-width; inside a row the label must size to its text (and may wrap on a narrow screen).
            child: TextButton(
              key: const Key('address-change-method'),
              style: TextButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: HatlySpacing.sm)),
              onPressed: _changeMethod,
              child: Text(l10n.addressChangeMethod, textAlign: TextAlign.center),
            ),
          ),
      ],
    );
  }

  Widget _optionalFields(AppLocalizations l10n, {required bool withNotes}) {
    const gap = SizedBox(height: HatlySpacing.ms);
    return Column(
      children: [
        if (withNotes) ...[
          _field(_instructions, l10n.checkoutAddressInstructionsHint, key: const Key('address-instructions'), maxLines: 2, maxLength: 500),
          gap,
        ],
        _field(_label, l10n.addressLabelHint, key: const Key('address-label'), maxLength: 100),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: Wrap(
            spacing: HatlySpacing.sm,
            children: [
              for (final preset in [l10n.addressLabelHome, l10n.addressLabelWork])
                ActionChip(label: Text(preset), onPressed: () => setState(() => _label.text = preset)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _saveRow(AppLocalizations l10n, {required bool enabled}) {
    final p = context.palette;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: HatlySpacing.sm),
        SwitchListTile(
          key: const Key('address-default'),
          contentPadding: EdgeInsets.zero,
          title: Text(l10n.addressMakeDefault),
          value: _isDefault,
          onChanged: (v) => setState(() => _isDefault = v),
        ),
        if (_error != null) ...[
          const SizedBox(height: HatlySpacing.sm),
          Text(_error!, key: const Key('address-error'), style: context.type.small.copyWith(color: p.urgent)),
        ],
        const SizedBox(height: HatlySpacing.lg),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            key: const Key('address-save'),
            style: hatlyAccentButtonStyle(context),
            onPressed: (_isSaving || !enabled) ? null : _save,
            child: _isSaving
                ? SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: p.accentOn))
                : Text(l10n.addressSaveButton),
          ),
        ),
      ],
    );
  }

  // ------------------------------------------------------------------------------------------------ GPS journey

  List<Widget> _gpsJourney(AppLocalizations l10n) {
    final p = context.palette;
    final located = _latitude != null && _longitude != null;
    return [
      _methodHeader(l10n, canChange: true),
      const SizedBox(height: HatlySpacing.sm),
      HatlySection(
        title: l10n.addressGpsJourneyTitle,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.addressGpsHelp, style: context.type.small.copyWith(color: p.textMuted)),
            const SizedBox(height: HatlySpacing.sm),
            // Location permission is requested only from here (after the customer chose GPS), by the button inside the picker.
            AddressPinPicker(
              latitude: _latitude,
              longitude: _longitude,
              mapEnabled: widget.mapEnabled ?? HatlyMaps.enabled,
              showSearch: false,
              onChanged: _onGpsPoint,
            ),
            if (located) ...[
              const SizedBox(height: HatlySpacing.sm),
              HatlySurface(
                key: const Key('address-gps-detected'),
                child: Row(
                  children: [
                    Icon(Icons.check_circle_outline, color: p.link),
                    const SizedBox(width: HatlySpacing.ms),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(l10n.addressGpsDetected, style: context.type.title),
                          if (_resolvedAddress != null) Text(_resolvedAddress!, key: const Key('address-gps-resolved'), style: context.type.body),
                          Text(gpsAddressText(_latitude!, _longitude!), key: const Key('address-gps-coordinates'), style: context.type.small),
                          const SizedBox(height: HatlySpacing.xs),
                          Text(l10n.addressGpsFeeNote, key: const Key('address-gps-fee-note'), style: context.type.small.copyWith(color: p.textMuted)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ] else if (_showErrors)
              Padding(
                padding: const EdgeInsets.only(top: HatlySpacing.sm),
                child: Text(l10n.addressGpsNeedLocation, key: const Key('address-gps-required'), style: context.type.small.copyWith(color: p.urgent)),
              ),
          ],
        ),
      ),
      const SizedBox(height: HatlySpacing.lg),
      HatlySection(title: l10n.addressDetailsSection, child: _optionalFields(l10n, withNotes: true)),
      _saveRow(l10n, enabled: located),
    ];
  }

  // ------------------------------------------------------------------------------------------------ manual journey

  List<Widget> _manualJourney(AppLocalizations l10n, {required bool canChangeMethod}) {
    const gap = SizedBox(height: HatlySpacing.ms);
    // Saving needs a delivery area from the backend. While the list is loading, failed or EMPTY there is nothing the customer can
    // choose, so the button stays off (the zone section explains why) instead of offering a save that can only fail.
    final zonesReady = ref.watch(deliveryZonesProvider).maybeWhen(data: (z) => z.isNotEmpty, orElse: () => false);
    return [
      if (canChangeMethod) ...[
        _methodHeader(l10n, canChange: true),
        const SizedBox(height: HatlySpacing.sm),
      ],
      _zoneSection(context, l10n),
      const SizedBox(height: HatlySpacing.lg),
      HatlySection(
        title: l10n.addressDetailsSection,
        child: Column(
          children: [
            _field(_line1, l10n.addressDetailedLabel,
                key: const Key('address-line1'),
                hint: l10n.addressDetailedHint,
                maxLines: 2,
                maxLength: 255,
                errorText: _showErrors && _line1.text.trim().isEmpty ? l10n.addressLine1Required : null),
            gap,
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: _field(_building, l10n.addressBuildingLabel, key: const Key('address-building'), maxLength: 40)),
                const SizedBox(width: HatlySpacing.ms),
                Expanded(child: _field(_floor, l10n.addressFloorLabel, key: const Key('address-floor'), maxLength: 20)),
                const SizedBox(width: HatlySpacing.ms),
                Expanded(child: _field(_apartment, l10n.addressApartmentLabel, key: const Key('address-apartment'), maxLength: 20)),
              ],
            ),
            gap,
            _field(_landmark, l10n.addressLandmarkLabel, key: const Key('address-landmark'), maxLength: 200),
            gap,
            _optionalFields(l10n, withNotes: true),
          ],
        ),
      ),
      _saveRow(l10n, enabled: zonesReady),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final capabilities = ref.watch(addressCapabilitiesProvider);
    // A backend that predates the two methods has only the (legacy) form: area + written address, no mode sent, no choice offered.
    final legacyBackend = capabilities.maybeWhen(data: (c) => !c.supportsModes, orElse: () => false);
    final mode = legacyBackend ? AddressMode.manual : _mode;

    return Scaffold(
      appBar: AppBar(title: Text(_isEditing ? l10n.editAddressTitle : l10n.addAddressTitle)),
      body: ListView(
        padding: const EdgeInsets.all(HatlySpacing.md),
        children: mode == null
            ? [_methodChooser(l10n, capabilities)]
            : mode == AddressMode.gps
                ? _gpsJourney(l10n)
                : _manualJourney(l10n, canChangeMethod: !legacyBackend),
      ),
    );
  }
}
