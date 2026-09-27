import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_key_value_row.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../data/addresses_providers.dart';
import '../domain/saved_address.dart';
import 'address_pin_picker.dart';

/// Create / edit a saved address.
///
/// The MAP PIN (latitude/longitude) is the authoritative location — the customer must set it. Google's address text is only
/// an assistive SUGGESTION: it never replaces what the customer writes, they choose whether to use it. The written details
/// (governorate, city, building, floor, apartment, landmark, label) are what the driver will read. Whether Hatly can deliver
/// to the point is decided by the server at checkout (service areas), not here.
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
  final _governorate = TextEditingController();
  final _city = TextEditingController();
  final _building = TextEditingController();
  final _floor = TextEditingController();
  final _apartment = TextEditingController();
  final _landmark = TextEditingController();
  final _instructions = TextEditingController();

  double? _latitude;
  double? _longitude;
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
      _governorate.text = e.governorate ?? '';
      _city.text = e.city ?? '';
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
    for (final c in [
      _label,
      _line1,
      _governorate,
      _city,
      _building,
      _floor,
      _apartment,
      _landmark,
      _instructions,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  /// The pin moved: remember it and ask (assistively) what Google calls that place. A missing suggestion is fine.
  Future<void> _onPin(double latitude, double longitude) async {
    setState(() {
      _latitude = latitude;
      _longitude = longitude;
      _suggestion = null;
      _suggestionUsed = false;
      _error = null;
    });
    final ticket = ++_lookupTicket;
    try {
      final text = await ref
          .read(addressesApiProvider)
          .reverseGeocode(latitude, longitude);
      if (!mounted || ticket != _lookupTicket) return;
      setState(() => _suggestion = text);
    } catch (_) {
      // No suggestion — the customer types the address; nothing is blocked.
    }
  }

  void _useSuggestion() {
    final text = _suggestion;
    if (text == null) return;
    setState(() {
      if (_line1.text.trim().isEmpty) _line1.text = text;
      _suggestionUsed = true;
    });
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context);
    setState(() => _showErrors = true);
    if (_latitude == null || _longitude == null) {
      setState(() => _error = l10n.addressMissingLocationError);
      return;
    }
    if (_line1.text.trim().isEmpty) return;

    setState(() {
      _isSaving = true;
      _error = null;
    });
    final input = AddressInput(
      label: _label.text,
      line1: _line1.text.trim(),
      latitude: _latitude!,
      longitude: _longitude!,
      instructions: _instructions.text,
      governorate: _governorate.text,
      city: _city.text,
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
        await api.updateAddress(widget.existing!.id, input);
        ref.invalidate(savedAddressesProvider);
        if (mounted) context.pop();
      } else {
        final saved = await api.createAddress(input);
        ref.invalidate(savedAddressesProvider);
        if (mounted) context.pop(saved);
      }
    } catch (_) {
      if (mounted) setState(() => _error = l10n.somethingWentWrong);
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Widget _field(TextEditingController controller, String label,
      {Key? key,
      int maxLines = 1,
      int? maxLength,
      String? errorText,
      TextInputType? keyboardType}) {
    return TextField(
      key: key,
      controller: controller,
      maxLines: maxLines,
      maxLength: maxLength,
      keyboardType: keyboardType,
      textInputAction:
          maxLines > 1 ? TextInputAction.newline : TextInputAction.next,
      decoration: InputDecoration(
        labelText: label,
        errorText: errorText,
        counterText: '',
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    const gap = SizedBox(height: HatlySpacing.ms);

    return Scaffold(
      appBar: AppBar(
          title:
              Text(_isEditing ? l10n.editAddressTitle : l10n.addAddressTitle)),
      body: ListView(
        padding: const EdgeInsets.all(HatlySpacing.md),
        children: [
          HatlySection(
            title: l10n.addressLocationSection,
            child: AddressPinPicker(
              latitude: _latitude,
              longitude: _longitude,
              mapEnabled: widget.mapEnabled ?? HatlyMaps.enabled,
              onChanged: _onPin,
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
                        Text(l10n.addressSuggestionLabel,
                            style: context.type.caption),
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
          const SizedBox(height: HatlySpacing.lg),
          HatlySection(
            title: l10n.addressDetailsSection,
            child: Column(
              children: [
                _field(_line1, l10n.addressLine1Label,
                    key: const Key('address-line1'),
                    maxLines: 2,
                    maxLength: 255,
                    errorText: _showErrors && _line1.text.trim().isEmpty
                        ? l10n.addressLine1Required
                        : null),
                gap,
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                        child: _field(
                            _governorate, l10n.addressGovernorateLabel,
                            key: const Key('address-governorate'),
                            maxLength: 80)),
                    const SizedBox(width: HatlySpacing.ms),
                    Expanded(
                        child: _field(_city, l10n.addressCityLabel,
                            key: const Key('address-city'), maxLength: 80)),
                  ],
                ),
                gap,
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                        child: _field(_building, l10n.addressBuildingLabel,
                            key: const Key('address-building'), maxLength: 40)),
                    const SizedBox(width: HatlySpacing.ms),
                    Expanded(
                        child: _field(_floor, l10n.addressFloorLabel,
                            key: const Key('address-floor'), maxLength: 20)),
                    const SizedBox(width: HatlySpacing.ms),
                    Expanded(
                        child: _field(_apartment, l10n.addressApartmentLabel,
                            key: const Key('address-apartment'),
                            maxLength: 20)),
                  ],
                ),
                gap,
                _field(_landmark, l10n.addressLandmarkLabel,
                    key: const Key('address-landmark'), maxLength: 200),
                gap,
                _field(_instructions, l10n.checkoutAddressInstructionsHint,
                    key: const Key('address-instructions'),
                    maxLines: 2,
                    maxLength: 500),
                gap,
                _field(_label, l10n.addressLabelHint,
                    key: const Key('address-label'), maxLength: 100),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Wrap(
                    spacing: HatlySpacing.sm,
                    children: [
                      for (final preset in [
                        l10n.addressLabelHome,
                        l10n.addressLabelWork
                      ])
                        ActionChip(
                          label: Text(preset),
                          onPressed: () => setState(() => _label.text = preset),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
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
            Text(_error!,
                key: const Key('address-error'),
                style: context.type.small.copyWith(color: p.urgent)),
          ],
          const SizedBox(height: HatlySpacing.lg),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              key: const Key('address-save'),
              style: hatlyAccentButtonStyle(context),
              onPressed: _isSaving ? null : _save,
              child: _isSaving
                  ? SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: p.accentOn))
                  : Text(l10n.addressSaveButton),
            ),
          ),
        ],
      ),
    );
  }
}
