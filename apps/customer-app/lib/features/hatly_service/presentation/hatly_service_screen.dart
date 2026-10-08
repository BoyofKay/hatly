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
import '../../addresses/presentation/address_pin_picker.dart';
import '../../cart/data/cart_providers.dart';
import '../../cart/domain/cart.dart';
import '../../cart/presentation/cart_error_messages.dart';
import '../../uploads/data/uploads_providers.dart';
import '../domain/hatly_service_type.dart';

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
  const HatlyServiceScreen({super.key, this.pickImageOverride});

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
  final _placeNameController = TextEditingController();
  final _descriptionController = TextEditingController();
  final List<XFile> _images = [];
  double? _pickupLat;
  double? _pickupLng;
  double? _destinationLat;
  double? _destinationLng;

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

  /// Hatly Service location rule: the place the customer chooses is REQUIRED for
  /// both types — BUY_FROM_PLACE's pickup and DELIVER_TO_PLACE's destination —
  /// matching the backend contract exactly (`CheckoutPlannerService
  /// .resolveAdHocLocations` rejects a missing one; no Hatly default location is
  /// ever substituted). Gating it here keeps the customer from reaching Submit
  /// without one; the matching `cart_error_messages.dart` /
  /// `checkout_error_messages.dart` mappings remain as defensive fallbacks.
  bool get _isValid => _existingGroupIdCache != null
      ? _descriptionController.text.trim().isNotEmpty
      : _serviceType != null &&
          _placeNameController.text.trim().isNotEmpty &&
          _descriptionController.text.trim().isNotEmpty &&
          (_serviceType == HatlyServiceType.deliverToPlace
              ? (_destinationLat != null && _destinationLng != null)
              : (_pickupLat != null && _pickupLng != null));

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

  void _goToReview() {
    if (!_isValid) return;
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

      final error =
          await ref.read(cartControllerProvider.notifier).addAdHocItem(
                cartVendorGroupId: existingGroupId,
                adHocPlaceName: existingGroupId == null
                    ? _placeNameController.text.trim()
                    : null,
                adHocServiceType: existingGroupId == null ? _serviceType : null,
                pickupLatitude: existingGroupId == null ? _pickupLat : null,
                pickupLongitude: existingGroupId == null ? _pickupLng : null,
                destinationLatitude:
                    existingGroupId == null ? _destinationLat : null,
                destinationLongitude:
                    existingGroupId == null ? _destinationLng : null,
                freeTextDescription: _descriptionController.text.trim(),
                quantity: 1,
                imageUrls: imageUrls.isEmpty ? null : imageUrls,
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

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final existingGroup = _existingGroup(ref);
    _existingGroupIdCache = existingGroup?.id;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.hatlyServiceScreenTitle)),
      body: SafeArea(
        child: _phase == _Phase.form
            ? _FormPhase(
                key: const ValueKey('hatly-service-form'),
                existingGroup: existingGroup,
                serviceType: _serviceType,
                onServiceTypeChanged: (t) => setState(() => _serviceType = t),
                placeNameController: _placeNameController,
                descriptionController: _descriptionController,
                images: _images,
                onPickImage: _pickImage,
                onRemoveImage: _removeImage,
                pickupLat: _pickupLat,
                pickupLng: _pickupLng,
                onPickupChanged: (lat, lng) => setState(() {
                  _pickupLat = lat;
                  _pickupLng = lng;
                }),
                destinationLat: _destinationLat,
                destinationLng: _destinationLng,
                onDestinationChanged: (lat, lng) => setState(() {
                  _destinationLat = lat;
                  _destinationLng = lng;
                }),
                onChanged: () => setState(() {}),
                isValid: _isValid,
                onContinue: _goToReview,
              )
            : _ReviewPhase(
                key: const ValueKey('hatly-service-review'),
                existingGroup: existingGroup,
                serviceType: _serviceType,
                placeName: _placeNameController.text.trim(),
                description: _descriptionController.text.trim(),
                images: _images,
                pickupLat: _pickupLat,
                pickupLng: _pickupLng,
                destinationLat: _destinationLat,
                destinationLng: _destinationLng,
                isSubmitting: _isSubmitting,
                errorMessage: _errorMessage,
                onEdit: _backToForm,
                onSubmit: () => _submit(existingGroup?.id),
              ),
      ),
    );
  }
}

typedef _PinChanged = void Function(double lat, double lng);

class _FormPhase extends StatelessWidget {
  const _FormPhase({
    super.key,
    required this.existingGroup,
    required this.serviceType,
    required this.onServiceTypeChanged,
    required this.placeNameController,
    required this.descriptionController,
    required this.images,
    required this.onPickImage,
    required this.onRemoveImage,
    required this.pickupLat,
    required this.pickupLng,
    required this.onPickupChanged,
    required this.destinationLat,
    required this.destinationLng,
    required this.onDestinationChanged,
    required this.onChanged,
    required this.isValid,
    required this.onContinue,
  });

  final CartGroup? existingGroup;
  final String? serviceType;
  final ValueChanged<String> onServiceTypeChanged;
  final TextEditingController placeNameController;
  final TextEditingController descriptionController;
  final List<XFile> images;
  final VoidCallback onPickImage;
  final ValueChanged<int> onRemoveImage;
  final double? pickupLat;
  final double? pickupLng;
  final _PinChanged onPickupChanged;
  final double? destinationLat;
  final double? destinationLng;
  final _PinChanged onDestinationChanged;
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
        if (!addingToExisting) ...[
          const SizedBox(height: HatlySpacing.lg),
          HatlySection(
            title: effectiveType == HatlyServiceType.deliverToPlace
                ? l10n.hatlyServiceLocationDestinationTitle
                : l10n.hatlyServiceLocationPickupTitle,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                    effectiveType == HatlyServiceType.deliverToPlace
                        ? l10n.hatlyServiceLocationDestinationHint
                        : l10n.hatlyServiceLocationPickupHint,
                    style: context.type.small),
                const SizedBox(height: HatlySpacing.sm),
                if (serviceType == HatlyServiceType.buyFromPlace)
                  AddressPinPicker(
                    key: const Key('hatly-service-pickup-picker'),
                    latitude: pickupLat,
                    longitude: pickupLng,
                    onChanged: onPickupChanged,
                  )
                else if (serviceType == HatlyServiceType.deliverToPlace)
                  AddressPinPicker(
                    key: const Key('hatly-service-destination-picker'),
                    latitude: destinationLat,
                    longitude: destinationLng,
                    onChanged: onDestinationChanged,
                  )
                else
                  Text(l10n.hatlyServiceTypeSectionTitle,
                      style: context.type.caption),
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
    required this.pickupLat,
    required this.pickupLng,
    required this.destinationLat,
    required this.destinationLng,
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
  final double? pickupLat;
  final double? pickupLng;
  final double? destinationLat;
  final double? destinationLng;
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
    final hasPickup = pickupLat != null && pickupLng != null;
    final hasDestination = destinationLat != null && destinationLng != null;
    final hasLocation = hasPickup || hasDestination;

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
                _reviewRow(context, l10n.hatlyServiceReviewDescriptionLabel,
                    description),
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
                if (!addingToExisting) ...[
                  const SizedBox(height: HatlySpacing.sm),
                  _reviewRow(
                    context,
                    l10n.hatlyServiceReviewLocationLabel,
                    hasLocation
                        ? l10n.hatlyServiceReviewLocationSet
                        : l10n.hatlyServiceReviewLocationRequired,
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
