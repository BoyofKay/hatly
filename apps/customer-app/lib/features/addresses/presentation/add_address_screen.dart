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

/// Create / edit a saved address (PD-009).
///
/// The DELIVERY ZONE the customer selects (Governorate → City → Area, all from `GET /delivery-zones` — never hardcoded) decides
/// whether Hatly delivers there and the base delivery fee; the written address is what the driver reads. The MAP PIN is
/// OPTIONAL and assistive: an address saves without it, and Google's address text is only a suggestion the customer may use.
/// The server stays authoritative — checkout re-quotes whatever is saved here.
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

  String? _governorate;
  String? _city;
  String? _zoneId;
  bool _zoneInitialized = false;

  /// True while the zone was chosen for the customer because it is the ONLY active zone of the selected city.
  bool _zoneAutoSelected = false;

  double? _latitude;
  double? _longitude;
  bool _locationRemoved = false;
  String? _suggestion;
  bool _suggestionUsed = false;
  bool _isDefault = false;
  bool _isSaving = false;
  bool _showErrors = false;
  String? _error;
  int _lookupTicket = 0;

  bool get _isEditing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      _label.text = e.label ?? '';
      _line1.text = e.line1;
      _building.text = e.buildingNumber ?? '';
      _floor.text = e.floor ?? '';
      _apartment.text = e.apartment ?? '';
      _landmark.text = e.landmark ?? '';
      _instructions.text = e.instructions ?? '';
      _latitude = e.latitude;
      _longitude = e.longitude;
      _suggestion = e.formattedAddress;
      _suggestionUsed = e.formattedAddress != null;
      _isDefault = e.isDefault;
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
    final existing = widget.existing;
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
    if (zones.any((z) => z.id == current.id)) _zoneId = current.id;
  }

  /// Data-driven, never hardcoded: when the backend offers exactly ONE governorate / city / active zone for the current
  /// selection, it is selected for the customer (shown as selected, still changeable). With several, the customer chooses.
  void _applySingleChoices(List<DeliveryZone> zones, {bool includeZone = true}) {
    final governorates = zones.map((z) => z.governorateAr).toSet();
    if (_governorate == null && governorates.length == 1) _governorate = governorates.first;
    final cities = zones.where((z) => z.governorateAr == _governorate).map((z) => z.cityAr).toSet();
    if (_city == null && cities.length == 1) _city = cities.first;
    if (!includeZone || _zoneId != null || _city == null) return;
    final cityZones = zones.where((z) => z.governorateAr == _governorate && z.cityAr == _city).toList();
    if (cityZones.length == 1) {
      _zoneId = cityZones.single.id;
      _zoneAutoSelected = true;
    }
  }

  /// The pin moved: remember it and ask (assistively) what Google calls that place. A missing suggestion is fine.
  Future<void> _onPin(double latitude, double longitude) async {
    setState(() {
      _latitude = latitude;
      _longitude = longitude;
      _locationRemoved = false;
      _suggestion = null;
      _suggestionUsed = false;
      _error = null;
    });
    final ticket = ++_lookupTicket;
    try {
      final text = await ref.read(addressesApiProvider).reverseGeocode(latitude, longitude);
      if (!mounted || ticket != _lookupTicket) return;
      setState(() => _suggestion = text);
    } catch (_) {
      // No suggestion — the customer types the address; nothing is blocked.
    }
  }

  void _removePin() {
    setState(() {
      _latitude = null;
      _longitude = null;
      _locationRemoved = widget.existing?.hasPin == true;
      _suggestion = null;
      _suggestionUsed = false;
      _lookupTicket++;
    });
  }

  void _useSuggestion() {
    final text = _suggestion;
    if (text == null) return;
    setState(() {
      if (_line1.text.trim().isEmpty) _line1.text = text;
      _suggestionUsed = true;
    });
  }

  String _errorMessage(AppLocalizations l10n, Object error) {
    if (error is ApiException) {
      switch (error.businessCode) {
        case 'DELIVERY_ZONE_UNAVAILABLE':
          return l10n.checkoutAddressZoneUnavailable;
        case 'ADDRESS_ZONE_REQUIRED':
          return l10n.addressZoneRequired;
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
    if (_zoneId == null || _line1.text.trim().isEmpty) return;

    setState(() {
      _isSaving = true;
      _error = null;
    });
    final input = AddressInput(
      label: _label.text,
      line1: _line1.text.trim(),
      deliveryZoneId: _zoneId!,
      latitude: _latitude,
      longitude: _longitude,
      removeLocation: _locationRemoved,
      instructions: _instructions.text,
      buildingNumber: _building.text,
      floor: _floor.text,
      apartment: _apartment.text,
      landmark: _landmark.text,
      // Kept only if the customer accepted it — it is a suggestion, never silently stored as fact.
      formattedAddress: _suggestionUsed ? _suggestion : null,
      isDefault: _isDefault ? true : null,
    );
    try {
      final api = ref.read(addressesApiProvider);
      if (_isEditing) {
        final saved = await api.updateAddress(widget.existing!.id, input);
        ref.invalidate(savedAddressesProvider);
        if (mounted) context.pop(saved);
      } else {
        final saved = await api.createAddress(input);
        ref.invalidate(savedAddressesProvider);
        if (mounted) context.pop(saved);
      }
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
          final areaZones = zones.where((z) => z.governorateAr == _governorate && z.cityAr == _city).toList();
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
                  _zoneId = null;
                  _zoneAutoSelected = false;
                  _applySingleChoices(zones);
                }),
              ),
              const SizedBox(height: HatlySpacing.ms),
              _dropdown<String>(
                key: ValueKey('address-zone-$_governorate-$_city'),
                label: l10n.addressZoneLabel,
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
              if (_city != null && areaZones.isEmpty) ...[
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

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    const gap = SizedBox(height: HatlySpacing.ms);

    return Scaffold(
      appBar: AppBar(title: Text(_isEditing ? l10n.editAddressTitle : l10n.addAddressTitle)),
      body: ListView(
        padding: const EdgeInsets.all(HatlySpacing.md),
        children: [
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
                _field(_instructions, l10n.checkoutAddressInstructionsHint,
                    key: const Key('address-instructions'), maxLines: 2, maxLength: 500),
                gap,
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
            ),
          ),
          const SizedBox(height: HatlySpacing.lg),
          HatlySection(
            title: l10n.addressLocationOptionalSection,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(l10n.addressLocationOptionalHelp, style: context.type.small.copyWith(color: p.textMuted)),
                const SizedBox(height: HatlySpacing.sm),
                AddressPinPicker(
                  latitude: _latitude,
                  longitude: _longitude,
                  mapEnabled: widget.mapEnabled ?? HatlyMaps.enabled,
                  onChanged: _onPin,
                ),
                if (_latitude != null && _longitude != null)
                  Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: TextButton.icon(
                      key: const Key('address-remove-pin'),
                      onPressed: _removePin,
                      icon: const Icon(Icons.location_off_outlined),
                      label: Text(l10n.addressRemoveLocation),
                    ),
                  ),
              ],
            ),
          ),
          if (_suggestion != null && !_suggestionUsed) ...[
            const SizedBox(height: HatlySpacing.sm),
            HatlySurface(
              key: const Key('address-suggestion'),
              child: Row(
                children: [
                  Icon(Icons.lightbulb_outline, color: p.textMuted),
                  const SizedBox(width: HatlySpacing.ms),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(l10n.addressSuggestionLabel, style: context.type.caption),
                        Text(_suggestion!, style: context.type.body),
                      ],
                    ),
                  ),
                  TextButton(
                    key: const Key('address-use-suggestion'),
                    onPressed: _useSuggestion,
                    child: Text(l10n.addressUseSuggestion),
                  ),
                ],
              ),
            ),
          ],
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
              onPressed: _isSaving ? null : _save,
              child: _isSaving
                  ? SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: p.accentOn))
                  : Text(l10n.addressSaveButton),
            ),
          ),
        ],
      ),
    );
  }
}
