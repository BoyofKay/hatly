import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_button.dart';
import '../../../../shared_widgets/hatly_error_banner.dart';
import '../../../auth/presentation/auth_gate.dart';
import '../../../cart/data/cart_providers.dart';
import '../../../uploads/data/uploads_providers.dart';
import '../../../cart/presentation/cart_error_messages.dart';

const int _maxCustomRequestImages = 2;

/// Vendor/Pharmacy Custom Request — the "Can't find what you're
/// looking for?" entry point on the Vendor/Branch catalog screen.
/// CONFIRMED: always targets THIS vendor's own CATALOG group (via
/// [vendorBranchId] — the backend reuses an existing CATALOG group
/// for this branch if one exists, or creates one, per
/// CartService.addVendorCustomItem) — never the External Hatly
/// Service / AD_HOC_SERVICE flow, which lives entirely elsewhere in
/// this app and is untouched by this widget.
class CustomRequestAction extends ConsumerWidget {
  const CustomRequestAction(
      {super.key, required this.vendorBranchId, this.pickImageOverride,
      this.floating = false});
  final bool floating;

  final String vendorBranchId;

  /// Test hook — same pattern as HatlyServiceScreen's own
  /// `pickImageOverride`; lets a test control image-pick timing without
  /// touching the real OS picker. Always null in production.
  final Future<XFile?> Function()? pickImageOverride;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    Future<void> openRequest() async {
      // Identical sign-in, upload, sheet and cart behavior regardless of entry.
      if (!requireSignIn(context, ref)) return;
      final messenger = ScaffoldMessenger.of(context);
      final added = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        builder: (_) => _CustomRequestSheet(
          vendorBranchId: vendorBranchId,
          pickImageOverride: pickImageOverride),
      );
      if (added == true) {
        messenger.showSnackBar(SnackBar(content: Text(l10n.customRequestAdded)));
      }
    }
    if (floating) {
      final label = l10n.vendorCustomBubbleLabel;
      return Tooltip(
        message: l10n.customRequestEntryPoint,
        child: Material(
          color: p.accent,
          elevation: 5,
          borderRadius: BorderRadius.circular(30),
          child: InkWell(
            key: const Key('vendor-custom-request-bubble'),
            borderRadius: BorderRadius.circular(30),
            onTap: openRequest,
            child: Semantics(
              button: true,
              label: l10n.customRequestEntryPoint,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                    horizontal: HatlySpacing.md, vertical: HatlySpacing.ms),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.add_shopping_cart_outlined, color: p.accentOn),
                  const SizedBox(width: HatlySpacing.xs),
                  Text(label, style: context.type.small.copyWith(
                    color: p.accentOn, fontWeight: FontWeight.w700)),
                ]),
              ),
            ),
          ),
        ),
      );
    }
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        HatlyButton(
          variant: HatlyButtonVariant.secondary,
          icon: Icons.help_outline,
          label: l10n.customRequestEntryPoint,
          fullWidth: false,
          onPressed: openRequest,
        ),
        const SizedBox(height: HatlySpacing.xs),
        Text(l10n.customRequestEntryHint,
          key: const Key('custom-request-hint'),
          textAlign: TextAlign.center,
          style: context.type.caption.copyWith(color: p.textMuted)),
      ],
    );
  }
}

class _CustomRequestSheet extends ConsumerStatefulWidget {
  const _CustomRequestSheet(
      {required this.vendorBranchId, this.pickImageOverride});

  final String vendorBranchId;
  final Future<XFile?> Function()? pickImageOverride;

  @override
  ConsumerState<_CustomRequestSheet> createState() =>
      _CustomRequestSheetState();
}

class _CustomRequestSheetState extends ConsumerState<_CustomRequestSheet> {
  final _textController = TextEditingController();
  final List<XFile> _selectedImages = [];
  bool _isSubmitting = false;
  String? _errorMessage;

  bool get _isValid =>
      _textController.text.trim().isNotEmpty || _selectedImages.isNotEmpty;

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    if (_selectedImages.length >= _maxCustomRequestImages) return;
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
    // Polish pass: a real setState-after-dispose bug — if the sheet is
    // dismissed while the OS image picker is open, this fired on an
    // already-disposed widget. Every other async method in this class
    // already guards with `mounted`; this one didn't.
    if (picked != null && mounted) {
      setState(() => _selectedImages.add(picked));
    }
  }

  void _removeImage(int index) {
    setState(() => _selectedImages.removeAt(index));
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    if (!_isValid || _isSubmitting) return;
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      // Upload every selected image FIRST — CONFIRMED: if any upload
      // fails, nothing is submitted to the cart at all (no partial/
      // invalid cart item is ever created).
      final uploadsApi = ref.read(uploadsApiProvider);
      final imageUrls = <String>[];
      for (final image in _selectedImages) {
        final bytes = await image.readAsBytes();
        final url = await uploadsApi.uploadImage(bytes, image.name);
        imageUrls.add(url);
      }

      final error =
          await ref.read(cartControllerProvider.notifier).addVendorCustomItem(
                vendorBranchId: widget.vendorBranchId,
                freeTextDescription: _textController.text.trim().isEmpty
                    ? null
                    : _textController.text.trim(),
                imageUrls: imageUrls.isEmpty ? null : imageUrls,
              );

      if (!mounted) return;
      if (error != null) {
        setState(
            () => _errorMessage = localizedCartErrorMessage(context, error));
        return;
      }
      Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) {
        setState(() => _errorMessage = l10n.somethingWentWrong);
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return Padding(
      padding: EdgeInsetsDirectional.only(
        start: HatlySpacing.md,
        end: HatlySpacing.md,
        top: HatlySpacing.md,
        bottom: MediaQuery.of(context).viewInsets.bottom + HatlySpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l10n.customRequestSheetTitle, style: context.type.title),
          const SizedBox(height: HatlySpacing.xs),
          Text(l10n.customRequestSheetSubtitle,
              style: context.type.caption.copyWith(color: p.textMuted)),
          const SizedBox(height: HatlySpacing.md),
          TextField(
            controller: _textController,
            maxLines: 3,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: l10n.customRequestTextHint,
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: HatlySpacing.ms),
          Row(
            children: [
              ..._selectedImages.asMap().entries.map(
                    (entry) => Padding(
                      padding: const EdgeInsetsDirectional.only(
                          end: HatlySpacing.sm),
                      child: Stack(
                        clipBehavior: Clip.none,
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: Image.file(File(entry.value.path),
                                width: 64, height: 64, fit: BoxFit.cover),
                          ),
                          // Polish pass: was a fixed physical `right:` offset —
                          // now mirrors correctly under RTL, matching the
                          // sibling Hatly Service screen's equivalent badge.
                          PositionedDirectional(
                            end: -4,
                            top: -4,
                            child: GestureDetector(
                              onTap: () => _removeImage(entry.key),
                              child: Semantics(
                                button: true,
                                label: l10n.customRequestRemoveImage,
                                child: CircleAvatar(
                                  radius: 10,
                                  // Polish pass: `HatlyColors.error` (fixed) ->
                                  // `p.urgent` (theme-aware) — the same fix
                                  // already applied to the error text below in
                                  // this same file. White stays: white-on-urgent
                                  // has good contrast in both themes (unlike
                                  // white-on-orange).
                                  backgroundColor: p.urgent,
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
              if (_selectedImages.length < _maxCustomRequestImages)
                Semantics(
                  button: true,
                  label: l10n.customRequestAddImage,
                  child: InkWell(
                    onTap: _pickImage,
                    child: Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(
                        // Audit F-L1: fixed `Colors.grey.shade400` border,
                        // same anti-pattern that breaks Dark Mode elsewhere.
                        // `p.textDisabled` is the closest existing token to the
                        // old grey (near-identical value in Light Mode).
                        border: Border.all(color: p.textDisabled),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Icon(Icons.add_a_photo_outlined),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: HatlySpacing.sm),
          Text(l10n.customRequestImageLimitHint(_maxCustomRequestImages),
              style: context.type.caption.copyWith(color: p.textMuted)),
          if (_errorMessage != null) ...[
            const SizedBox(height: HatlySpacing.sm),
            HatlyErrorBanner(message: _errorMessage!),
          ],
          const SizedBox(height: HatlySpacing.md),
          HatlyButton(
            label: l10n.customRequestSubmit,
            isLoading: _isSubmitting,
            onPressed: _isValid ? _submit : null,
          ),
        ],
      ),
    );
  }
}
