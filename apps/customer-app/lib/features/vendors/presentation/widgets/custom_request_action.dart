import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../cart/data/cart_providers.dart';
import '../../../uploads/data/uploads_providers.dart';

const int _maxCustomRequestImages = 2;

/// Vendor/Pharmacy Custom Request — the "Can't find what you're
/// looking for?" entry point on the Vendor/Branch catalog screen.
/// CONFIRMED: always targets THIS vendor's own CATALOG group (via
/// [vendorBranchId] — the backend reuses an existing CATALOG group
/// for this branch if one exists, or creates one, per
/// CartService.addVendorCustomItem) — never the External Hatly
/// Service / AD_HOC_SERVICE flow, which lives entirely elsewhere in
/// this app and is untouched by this widget.
class CustomRequestAction extends StatelessWidget {
  const CustomRequestAction({super.key, required this.vendorBranchId});

  final String vendorBranchId;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return OutlinedButton.icon(
      onPressed: () => showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        builder: (_) => _CustomRequestSheet(vendorBranchId: vendorBranchId),
      ),
      icon: const Icon(Icons.help_outline),
      label: Text(l10n.customRequestEntryPoint),
    );
  }
}

class _CustomRequestSheet extends ConsumerStatefulWidget {
  const _CustomRequestSheet({required this.vendorBranchId});

  final String vendorBranchId;

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
    final picked = await ImagePicker()
        .pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked != null) {
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
        setState(() => _errorMessage = error.message);
        return;
      }
      Navigator.of(context).pop();
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
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l10n.customRequestSheetTitle,
              style:
                  const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text(l10n.customRequestSheetSubtitle,
              style:
                  const TextStyle(fontSize: 13, color: HatlyColors.textMuted)),
          const SizedBox(height: 16),
          TextField(
            controller: _textController,
            maxLines: 3,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: l10n.customRequestTextHint,
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              ..._selectedImages.asMap().entries.map(
                    (entry) => Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Stack(
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: Image.file(File(entry.value.path),
                                width: 64, height: 64, fit: BoxFit.cover),
                          ),
                          Positioned(
                            right: -4,
                            top: -4,
                            child: GestureDetector(
                              onTap: () => _removeImage(entry.key),
                              child: const CircleAvatar(
                                radius: 10,
                                backgroundColor: HatlyColors.error,
                                child: Icon(Icons.close,
                                    size: 14, color: Colors.white),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              if (_selectedImages.length < _maxCustomRequestImages)
                InkWell(
                  onTap: _pickImage,
                  child: Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      border: Border.all(color: Colors.grey.shade400),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Icon(Icons.add_a_photo_outlined),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(l10n.customRequestImageLimitHint(_maxCustomRequestImages),
              style:
                  const TextStyle(fontSize: 11, color: HatlyColors.textMuted)),
          if (_errorMessage != null) ...[
            const SizedBox(height: 8),
            Text(_errorMessage!,
                style: const TextStyle(color: HatlyColors.error)),
          ],
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _isValid && !_isSubmitting ? _submit : null,
              child: _isSubmitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(l10n.customRequestSubmit),
            ),
          ),
        ],
      ),
    );
  }
}
