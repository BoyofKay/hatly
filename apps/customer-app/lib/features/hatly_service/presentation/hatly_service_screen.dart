import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_error_banner.dart';
import '../../../shared_widgets/hatly_primary_button.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../../../shared_widgets/voice_note/voice_note_engine.dart';
import '../../../shared_widgets/voice_note/voice_note_field.dart';
import '../../cart/data/cart_providers.dart';
import '../../cart/domain/cart.dart';
import '../../cart/presentation/cart_error_messages.dart';
import '../../uploads/data/uploads_providers.dart';
import '../data/hatly_service_api.dart';
import '../domain/hatly_service_type.dart';
import '../domain/route_endpoint.dart';
import 'widgets/route_endpoint_sheet.dart';
import 'widgets/route_summary.dart';

/// Standalone Hatly Service — the customer-facing creation UI for an
/// AD_HOC_SERVICE cart item. CONFIRMED distinct from, and never
/// touching, the Vendor/Pharmacy Custom Request
/// (`CustomRequestAction`/`addVendorCustomItem`) — that flow always
/// targets a vendor's own CATALOG group and is untouched here; this
/// screen only ever calls [CartController.addAdHocItem].
///
/// Flow: pick a service type -> describe the request (text required,
/// up to 2 photos optional) -> optionally set the service-specific
/// location -> review (editable) -> add to the existing cart via the
/// existing `addAdHocItem()` API -> existing cart/checkout/order flow.
/// A single screen (not a multi-route wizard) with two internal
/// phases so there is one real "review before submit" step without
/// duplicating the checkout screen.
const int hatlyServiceMaxImages = 2;

class HatlyServiceScreen extends ConsumerStatefulWidget {
  const HatlyServiceScreen({super.key, this.pickImageOverride, this.buyFromPlaceOnly = false});

  /// Sector-listing entry: present only Hatly/Buys From Place. Never alters cart rules.
  final bool buyFromPlaceOnly;

  /// Test hook only — defaults to the real gallery picker
  /// (`ImagePicker().pickImage(...)`, the same call
  /// `custom_request_action.dart` makes) in production.
  final Future<XFile?> Function()? pickImageOverride;

  @override
  ConsumerState<HatlyServiceScreen> createState() => _HatlyServiceScreenState();
}

enum _Phase { form, review }

class _HatlyServiceScreenState extends ConsumerState<HatlyServiceScreen> {
  _Phase _phase = _Phase.form;

  String? _serviceType;

  @override
  void initState() {
    super.initState();
    if (widget.buyFromPlaceOnly) _serviceType = HatlyServiceType.buyFromPlace;
  }
  final _placeNameController = TextEditingController();
  final _descriptionController = TextEditingController();
  final List<XFile> _images = [];
  VoiceNoteDraft? _voice;
  // The route ends the CUSTOMER chose (PD-012). Null = "use the service default", which the server resolves again at quote and order time:
  //   هاتلي من مكان (Hatly):   origin = chosen, else Hatly's default start;   destination = chosen, else Hatly's default destination
  //   وصّلي لمكان (Wasally):   origin = ALWAYS chosen (never assumed to be home);   destination = chosen, else Wasally's default destination
  // The customer's own address is never an end unless they pick it as one.
  RouteEndpoint? _originChoice;
  RouteEndpoint? _destinationChoice;

  RouteEndpoint? _effectiveOrigin(RouteDefaults d) =>
      _originChoice ?? (_serviceType == HatlyServiceType.buyFromPlace ? d.hatlyOrigin : null);

  RouteEndpoint? _effectiveDestination(RouteDefaults d) =>
      _destinationChoice ??
      switch (_serviceType) {
        HatlyServiceType.buyFromPlace => d.hatlyDestination,
        HatlyServiceType.deliverToPlace => d.wasallyDestination,
        _ => null,
      };

  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _placeNameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  /// CONFIRMED business rule (cart.service.ts `assertCanAddNewGroup`):
  /// a cart may contain at most ONE AD_HOC_SERVICE group. When one
  /// already exists, this request must be added to it via
  /// `cartVendorGroupId` — the type/place-name/location fields are
  /// only meaningful when starting a brand-new group, so they are
  /// hidden entirely in that case rather than collected and ignored.
  CartGroup? _existingGroup(WidgetRef ref) {
    final cart = ref.watch(cartControllerProvider).valueOrNull;
    if (cart == null) return null;
    for (final g in cart.groups) {
      if (g.isAdHocService) return g;
    }
    return null;
  }

  /// A new request needs a type, a place name, a description and BOTH route ends resolved (the customer's choice or the service's
  /// configured default). Wasally's origin has no default, so it is always the customer's. The server re-resolves and validates the
  /// route at quote and order time; gating here only keeps the customer from reaching Submit without a usable route.
  /// Owner decision 2026-11-27: what to buy / deliver may be written, shown in a photo or said in a voice note — any one is enough.
  bool get _hasContent => _descriptionController.text.trim().isNotEmpty || _images.isNotEmpty || _voice != null;

  bool _isValid(RouteDefaults defaults) => _existingGroupIdCache != null
      ? _hasContent
      : _serviceType != null &&
          _placeNameController.text.trim().isNotEmpty &&
          _hasContent &&
          _effectiveOrigin(defaults) != null &&
          _effectiveDestination(defaults) != null;

  String? _existingGroupIdCache;

  Future<void> _pickImage() async {
    if (_images.length >= hatlyServiceMaxImages) return;
    final picked = widget.pickImageOverride != null
        ? await widget.pickImageOverride!()
        : await ImagePicker()
            // Downscaled on the device (long edge 1600 px): a full-resolution photo is several MB of mobile data and
            // server memory for no visible benefit at the size these reference photos are shown.
            .pickImage(
                source: ImageSource.gallery,
                imageQuality: 85,
                maxWidth: 1600,
                maxHeight: 1600);
    if (picked != null && mounted) {
      setState(() => _images.add(picked));
    }
  }

  void _removeImage(int index) => setState(() => _images.removeAt(index));

  void _goToReview(RouteDefaults defaults) {
    if (!_isValid(defaults)) return;
    setState(() {
      _phase = _Phase.review;
      _errorMessage = null;
    });
  }

  void _backToForm() => setState(() => _phase = _Phase.form);

  Future<void> _submit(String? existingGroupId) async {
    if (_isSubmitting) return;
    final l10n = AppLocalizations.of(context);
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      // Upload every selected image FIRST — mirrors the proven Vendor
      // Custom Request pattern exactly: if any upload fails, nothing
      // is submitted to the cart, and the entered text/images stay on
      // screen for the customer to retry.
      final uploadsApi = ref.read(uploadsApiProvider);
      final imageUrls = <String>[];
      for (final image in _images) {
        final bytes = await image.readAsBytes();
        final url = await uploadsApi.uploadImage(bytes, image.name);
        imageUrls.add(url);
      }
      final voice = _voice;
      final voiceNoteUrl = voice == null
          ? null
          : await uploadsApi.uploadAudio(await ref.read(voiceNoteEngineProvider).readBytes(voice.path));

      final error =
          await ref.read(cartControllerProvider.notifier).addAdHocItem(
                cartVendorGroupId: existingGroupId,
                adHocPlaceName: existingGroupId == null
                    ? _placeNameController.text.trim()
                    : null,
                adHocServiceType: existingGroupId == null ? _serviceType : null,
                // Only what the customer chose is sent; an end left on "default" stays null and the server resolves it.
                pickupLatitude: existingGroupId == null ? _originChoice?.latitude : null,
                pickupLongitude: existingGroupId == null ? _originChoice?.longitude : null,
                pickupLabel: existingGroupId == null ? _originChoice?.label : null,
                destinationLatitude: existingGroupId == null ? _destinationChoice?.latitude : null,
                destinationLongitude: existingGroupId == null ? _destinationChoice?.longitude : null,
                destinationLabel: existingGroupId == null ? _destinationChoice?.label : null,
                freeTextDescription: _descriptionController.text.trim(),
                quantity: 1,
                imageUrls: imageUrls.isEmpty ? null : imageUrls,
                voiceNoteUrl: voiceNoteUrl,
              );

      if (!mounted) return;
      if (error != null) {
        setState(
            () => _errorMessage = localizedCartErrorMessage(context, error));
        return;
      }
      final messenger = ScaffoldMessenger.of(context);
      final router = GoRouter.of(context);
      messenger.showSnackBar(
          SnackBar(content: Text(l10n.hatlyServiceAddedConfirmation)));
      router.push('/cart');
    } catch (_) {
      if (mounted) setState(() => _errorMessage = l10n.somethingWentWrong);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  /// The ends in effect for the request being edited: an existing cart group's own (its customer-chosen ends, else the service default)
  /// or the new request's choices. Never the customer's address.
  ({RouteEndpoint? origin, RouteEndpoint? destination}) _routeFor(CartGroup? existing, RouteDefaults d) {
    if (existing == null) return (origin: _effectiveOrigin(d), destination: _effectiveDestination(d));
    final isBuy = existing.adHocServiceType == HatlyServiceType.buyFromPlace;
    RouteEndpoint? chosen(double? lat, double? lng, String? label) => lat == null || lng == null
        ? null
        : RouteEndpoint(latitude: lat, longitude: lng, label: label ?? '', source: RouteEndpointSource.customer);
    return (
      origin: chosen(existing.adHocPickupLatitude, existing.adHocPickupLongitude, existing.adHocPickupLabel) ?? (isBuy ? d.hatlyOrigin : null),
      destination: chosen(existing.adHocDestinationLatitude, existing.adHocDestinationLongitude, existing.adHocDestinationLabel) ??
          (isBuy ? d.hatlyDestination : d.wasallyDestination),
    );
  }

  Future<void> _editEndpoint({required bool isOrigin, required CartGroup? existing, required RouteDefaults defaults}) async {
    final type = existing?.adHocServiceType ?? _serviceType;
    final isBuy = type == HatlyServiceType.buyFromPlace;
    final route = _routeFor(existing, defaults);
    final choice = await showRouteEndpointSheet(
      context,
      isOrigin: isOrigin,
      current: isOrigin ? route.origin : route.destination,
      defaultEndpoint: isOrigin ? (isBuy ? defaults.hatlyOrigin : null) : (isBuy ? defaults.hatlyDestination : defaults.wasallyDestination),
    );
    if (choice == null || !mounted) return;
    if (existing != null) {
      // The request is already in the cart: store the new end there (each end independently; "default" clears the customer's choice).
      final error = await ref.read(cartControllerProvider.notifier).updateAdHocRoute(
            origin: isOrigin ? choice.endpoint : null,
            clearOrigin: isOrigin && choice.useDefault,
            destination: isOrigin ? null : choice.endpoint,
            clearDestination: !isOrigin && choice.useDefault,
          );
      if (!mounted) return;
      setState(() => _errorMessage = error == null ? null : localizedCartErrorMessage(context, error));
      return;
    }
    setState(() {
      if (isOrigin) {
        _originChoice = choice.useDefault ? null : choice.endpoint;
      } else {
        _destinationChoice = choice.useDefault ? null : choice.endpoint;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final existingGroup = _existingGroup(ref);
    _existingGroupIdCache = existingGroup?.id;
    // An existing Wasaly cart group cannot be silently changed or extended by
    // a sector-only Hatly entry. The established cart remains untouched.
    if (widget.buyFromPlaceOnly &&
        existingGroup?.adHocServiceType == HatlyServiceType.deliverToPlace) {
      final l10n = AppLocalizations.of(context);
      return Scaffold(
        appBar: AppBar(title: Text(l10n.hatlyServiceScreenTitle)),
        body: Center(child: Padding(
          padding: const EdgeInsets.all(HatlySpacing.lg),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.info_outline_rounded, size: 42),
            const SizedBox(height: HatlySpacing.md),
            Text(l10n.sectorHatlyExistingWasaly,
              textAlign: TextAlign.center, style: context.type.body),
            const SizedBox(height: HatlySpacing.md),
            TextButton.icon(onPressed: () => context.push('/cart'),
              icon: const Icon(Icons.shopping_cart_outlined),
              label: Text(l10n.cartSummaryViewCart)),
          ]),
        )),
      );
    }
    // While the defaults load (or if they cannot be read) nothing is configured: the customer simply chooses the ends themselves.
    final defaults = ref.watch(routeDefaultsProvider).valueOrNull ?? RouteDefaults.none;
    final route = _routeFor(existingGroup, defaults);
    final isBuy = (existingGroup?.adHocServiceType ?? _serviceType) == HatlyServiceType.buyFromPlace;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.hatlyServiceScreenTitle)),
      body: SafeArea(
        child: _phase == _Phase.form
            ? _FormPhase(
                key: const ValueKey('hatly-service-form'),
                existingGroup: existingGroup,
                serviceType: _serviceType,
                buyFromPlaceOnly: widget.buyFromPlaceOnly,
                onServiceTypeChanged: (t) => setState(() {
                  // The two services have different defaults and rules, so a choice made for the other one is dropped.
                  if (t != _serviceType) {
                    _originChoice = null;
                    _destinationChoice = null;
                  }
                  _serviceType = t;
                }),
                placeNameController: _placeNameController,
                descriptionController: _descriptionController,
                images: _images,
                onPickImage: _pickImage,
                onRemoveImage: _removeImage,
                voice: _voice,
                onVoiceChanged: (v) => setState(() => _voice = v),
                origin: route.origin,
                destination: route.destination,
                originHint: isBuy ? l10n.routeDefaultMissingHint : l10n.routeOriginRequiredHint,
                destinationHint: l10n.routeDefaultMissingHint,
                onEditOrigin: () => _editEndpoint(isOrigin: true, existing: existingGroup, defaults: defaults),
                onEditDestination: () => _editEndpoint(isOrigin: false, existing: existingGroup, defaults: defaults),
                errorMessage: _errorMessage,
                onChanged: () => setState(() {}),
                isValid: _isValid(defaults),
                onContinue: () => _goToReview(defaults),
              )
            : _ReviewPhase(
                key: const ValueKey('hatly-service-review'),
                existingGroup: existingGroup,
                serviceType: _serviceType,
                placeName: _placeNameController.text.trim(),
                description: _descriptionController.text.trim(),
                images: _images,
                voice: _voice,
                origin: route.origin,
                destination: route.destination,
                isSubmitting: _isSubmitting,
                errorMessage: _errorMessage,
                onEdit: _backToForm,
                onSubmit: () => _submit(existingGroup?.id),
              ),
      ),
    );
  }
}

class _FormPhase extends StatelessWidget {
  const _FormPhase({
    super.key,
    required this.existingGroup,
    required this.serviceType,
    required this.buyFromPlaceOnly,
    required this.onServiceTypeChanged,
    required this.placeNameController,
    required this.descriptionController,
    required this.images,
    required this.onPickImage,
    required this.onRemoveImage,
    required this.voice,
    required this.onVoiceChanged,
    required this.origin,
    required this.destination,
    required this.originHint,
    required this.destinationHint,
    required this.onEditOrigin,
    required this.onEditDestination,
    required this.errorMessage,
    required this.onChanged,
    required this.isValid,
    required this.onContinue,
  });

  final CartGroup? existingGroup;
  final String? serviceType;
  final bool buyFromPlaceOnly;
  final ValueChanged<String> onServiceTypeChanged;
  final TextEditingController placeNameController;
  final TextEditingController descriptionController;
  final List<XFile> images;
  final VoidCallback onPickImage;
  final ValueChanged<int> onRemoveImage;
  final VoiceNoteDraft? voice;
  final ValueChanged<VoiceNoteDraft?> onVoiceChanged;
  final RouteEndpoint? origin;
  final RouteEndpoint? destination;
  final String originHint;
  final String destinationHint;
  final VoidCallback onEditOrigin;
  final VoidCallback onEditDestination;
  final String? errorMessage;
  final VoidCallback onChanged;
  final bool isValid;
  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final addingToExisting = existingGroup != null;
    final effectiveType =
        addingToExisting ? existingGroup!.adHocServiceType : serviceType;

    return ListView(
      padding: const EdgeInsets.all(HatlySpacing.md),
      children: [
        if (addingToExisting) ...[
          HatlySurface(
            key: const Key('hatly-service-existing-group-notice'),
            child: Text(l10n.hatlyServiceExistingGroupNotice,
                style: context.type.small),
          ),
          const SizedBox(height: HatlySpacing.lg),
        ] else ...[
          HatlySection(
            title: l10n.hatlyServiceTypeSectionTitle,
            child: Column(
              children: [
                _ServiceTypeTile(
                  key: const Key('hatly-service-type-buy'),
                  title: l10n.hatlyServiceTypeBuyFromPlace,
                  subtitle: l10n.hatlyServiceTypeBuyFromPlaceHint,
                  icon: Icons.storefront_outlined,
                  selected: serviceType == HatlyServiceType.buyFromPlace,
                  onTap: () =>
                      onServiceTypeChanged(HatlyServiceType.buyFromPlace),
                ),
                if (!buyFromPlaceOnly) ...[
                  const SizedBox(height: HatlySpacing.sm),
                  _ServiceTypeTile(
                    key: const Key('hatly-service-type-deliver'),
                  title: l10n.hatlyServiceTypeDeliverToPlace,
                  subtitle: l10n.hatlyServiceTypeDeliverToPlaceHint,
                  icon: Icons.delivery_dining_outlined,
                  selected: serviceType == HatlyServiceType.deliverToPlace,
                    onTap: () =>
                        onServiceTypeChanged(HatlyServiceType.deliverToPlace),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: HatlySpacing.lg),
          HatlySection(
            title: l10n.hatlyServicePlaceNameLabel,
            child: TextField(
              key: const Key('hatly-service-place-name'),
              controller: placeNameController,
              maxLength: 120,
              textInputAction: TextInputAction.next,
              onChanged: (_) => onChanged(),
              decoration: InputDecoration(
                hintText: l10n.hatlyServicePlaceNameHint,
                counterText: '',
              ),
            ),
          ),
          const SizedBox(height: HatlySpacing.lg),
        ],
        Text(l10n.hatlyServiceContentHint, key: const Key('hatly-service-content-hint'), style: context.type.small),
        const SizedBox(height: HatlySpacing.sm),
        HatlySection(
          title: l10n.hatlyServiceDescriptionLabel,
          child: TextField(
            key: const Key('hatly-service-description'),
            controller: descriptionController,
            maxLines: 4,
            // Polish pass: was hardcoded RTL — the app ships a real English
            // locale too, so an English-mode customer typing here was forced
            // into right-to-left entry. Omitting this lets the field take
            // its direction from the ambient `Directionality`, like every
            // other text field in this screen.
            onChanged: (_) => onChanged(),
            decoration: InputDecoration(
              hintText: l10n.hatlyServiceDescriptionHint,
            ),
          ),
        ),
        const SizedBox(height: HatlySpacing.lg),
        HatlySection(
          title: l10n.hatlyServiceImagesLabel,
          child: Row(
            children: [
              ...images.asMap().entries.map(
                    (entry) => Padding(
                      padding: const EdgeInsetsDirectional.only(end: 8),
                      child: Stack(
                        children: [
                          ClipRRect(
                            borderRadius:
                                BorderRadius.circular(HatlyRadius.chip),
                            child: Image.file(File(entry.value.path),
                                width: 72, height: 72, fit: BoxFit.cover),
                          ),
                          PositionedDirectional(
                            end: -4,
                            top: -4,
                            child: GestureDetector(
                              key: Key(
                                  'hatly-service-remove-image-${entry.key}'),
                              onTap: () => onRemoveImage(entry.key),
                              child: Semantics(
                                button: true,
                                label: l10n.customRequestRemoveImage,
                                child: CircleAvatar(
                                  radius: 10,
                                  // Polish pass: `HatlyColors.error` (fixed) ->
                                  // `p.urgent` (theme-aware). White stays: good
                                  // contrast on urgent-red in both themes.
                                  backgroundColor: context.palette.urgent,
                                  child: const Icon(Icons.close,
                                      size: 14, color: Colors.white),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              if (images.length < hatlyServiceMaxImages)
                Semantics(
                  button: true,
                  label: l10n.customRequestAddImage,
                  child: InkWell(
                    key: const Key('hatly-service-add-image'),
                    onTap: onPickImage,
                    child: Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        border: Border.all(color: context.palette.border),
                        borderRadius: BorderRadius.circular(HatlyRadius.chip),
                      ),
                      child: Icon(Icons.add_a_photo_outlined,
                          color: context.palette.textMuted),
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: HatlySpacing.lg),
        HatlySection(
          title: l10n.voiceNoteSection,
          child: VoiceNoteField(key: const Key('hatly-service-voice'), value: voice, onChanged: onVoiceChanged),
        ),
        if (effectiveType != null) ...[
          const SizedBox(height: HatlySpacing.lg),
          // The route (PD-012): origin → destination, each end the customer's choice or the service's configured default, each
          // changeable on its own. Shown for a request already in the cart too — its ends are edited in place.
          HatlySection(
            title: l10n.routeSectionTitle,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.routeDirectionNote, style: context.type.small),
                const SizedBox(height: HatlySpacing.sm),
                RouteSummary(
                  key: const Key('hatly-service-route'),
                  origin: origin,
                  destination: destination,
                  originHint: originHint,
                  destinationHint: destinationHint,
                  onChangeOrigin: onEditOrigin,
                  onChangeDestination: onEditDestination,
                ),
                if (errorMessage != null) ...[
                  const SizedBox(height: HatlySpacing.sm),
                  HatlyErrorBanner(key: const Key('hatly-service-route-error'), message: errorMessage!),
                ],
              ],
            ),
          ),
        ],
        const SizedBox(height: HatlySpacing.xl),
        HatlyPrimaryButton(
          label: l10n.hatlyServiceContinueToReview,
          onPressed: isValid ? onContinue : null,
        ),
      ],
    );
  }
}

class _ServiceTypeTile extends StatelessWidget {
  const _ServiceTypeTile({
    super.key,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Semantics(
      button: true,
      selected: selected,
      label: title,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(HatlyRadius.card),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: HatlyTouch.minTarget),
          child: Container(
            padding: const EdgeInsets.all(HatlySpacing.ms),
            decoration: BoxDecoration(
              color: selected ? p.accentSoft : p.surface,
              border: Border.all(color: selected ? p.accent : p.border),
              borderRadius: BorderRadius.circular(HatlyRadius.card),
            ),
            child: Row(
              children: [
                Icon(icon, color: selected ? p.accent : p.textMuted),
                const SizedBox(width: HatlySpacing.ms),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: context.type.body
                              .copyWith(fontWeight: FontWeight.w700)),
                      Text(subtitle, style: context.type.caption),
                    ],
                  ),
                ),
                if (selected)
                  Icon(Icons.check_circle, color: p.accent, size: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ReviewPhase extends StatelessWidget {
  const _ReviewPhase({
    super.key,
    required this.existingGroup,
    required this.serviceType,
    required this.placeName,
    required this.description,
    required this.images,
    required this.voice,
    required this.origin,
    required this.destination,
    required this.isSubmitting,
    required this.errorMessage,
    required this.onEdit,
    required this.onSubmit,
  });

  final CartGroup? existingGroup;
  final String? serviceType;
  final String placeName;
  final String description;
  final List<XFile> images;
  final VoiceNoteDraft? voice;
  final RouteEndpoint? origin;
  final RouteEndpoint? destination;
  final bool isSubmitting;
  final String? errorMessage;
  final VoidCallback onEdit;
  final Future<void> Function() onSubmit;

  String _typeLabel(AppLocalizations l10n, String? type) {
    switch (type) {
      case HatlyServiceType.buyFromPlace:
        return l10n.hatlyServiceTypeBuyFromPlace;
      case HatlyServiceType.deliverToPlace:
        return l10n.hatlyServiceTypeDeliverToPlace;
      default:
        return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final addingToExisting = existingGroup != null;
    final effectiveType =
        addingToExisting ? existingGroup!.adHocServiceType : serviceType;

    return ListView(
      padding: const EdgeInsets.all(HatlySpacing.md),
      children: [
        HatlySection(
          title: l10n.hatlyServiceReviewTitle,
          trailing: TextButton(
            key: const Key('hatly-service-edit'),
            onPressed: isSubmitting ? null : onEdit,
            child: Text(l10n.hatlyServiceReviewEdit),
          ),
          child: HatlySurface(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (!addingToExisting) ...[
                  _reviewRow(context, l10n.hatlyServiceReviewTypeLabel,
                      _typeLabel(l10n, effectiveType)),
                  _reviewRow(
                      context, l10n.hatlyServiceReviewPlaceLabel, placeName),
                ],
                if (description.isNotEmpty)
                  _reviewRow(context, l10n.hatlyServiceReviewDescriptionLabel,
                      description),
                if (voice != null)
                  _reviewRow(context, l10n.voiceNoteAttached,
                      formatVoiceDuration(voice!.duration)),
                if (images.isNotEmpty) ...[
                  const SizedBox(height: HatlySpacing.sm),
                  Text(l10n.hatlyServiceReviewImagesLabel,
                      style: context.type.caption),
                  const SizedBox(height: HatlySpacing.xs),
                  Row(
                    children: images
                        .map((img) => Padding(
                              padding: const EdgeInsetsDirectional.only(end: 8),
                              child: ClipRRect(
                                borderRadius:
                                    BorderRadius.circular(HatlyRadius.chip),
                                child: Image.file(File(img.path),
                                    width: 56, height: 56, fit: BoxFit.cover),
                              ),
                            ))
                        .toList(),
                  ),
                ],
                if (effectiveType != null) ...[
                  const SizedBox(height: HatlySpacing.sm),
                  Text(l10n.routeSectionTitle, style: context.type.caption),
                  const SizedBox(height: HatlySpacing.xs),
                  // The route exactly as it will be requested — resolved ends, read only, nothing hidden.
                  RouteSummary(
                    key: const Key('hatly-service-review-route'),
                    origin: origin,
                    destination: destination,
                  ),
                ],
              ],
            ),
          ),
        ),
        if (errorMessage != null) ...[
          const SizedBox(height: HatlySpacing.md),
          HatlyErrorBanner(
              key: const Key('hatly-service-error'), message: errorMessage!),
        ],
        const SizedBox(height: HatlySpacing.xl),
        HatlyPrimaryButton(
          label: l10n.hatlyServiceSubmit,
          isLoading: isSubmitting,
          onPressed: isSubmitting ? null : () => onSubmit(),
        ),
      ],
    );
  }

  Widget _reviewRow(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: HatlySpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: context.type.caption),
          Text(value, style: context.type.body),
        ],
      ),
    );
  }
}
