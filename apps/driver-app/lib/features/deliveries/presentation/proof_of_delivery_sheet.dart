import 'dart:typed_data';
import 'package:flutter/material.dart';
import '../../../core/localization/bilingual.dart';

typedef PickPhotoBytes = Future<({Uint8List bytes, String filename})?> Function();

class ProofOfDeliveryResult {
  const ProofOfDeliveryResult({required this.photoUrl, this.recipientName});

  final String photoUrl;
  final String? recipientName;
}

/// M4 — Proof of Delivery. A photo is REQUIRED before a delivery can be marked
/// DELIVERED — the backend itself refuses the transition without one (see
/// `ProofOfDeliveryService.recordForDelivery`, `PROOF_PHOTO_REQUIRED`); this sheet
/// is what makes that unreachable in practice, not just unreachable server-side.
/// Recipient name is optional real evidence, never validated against a customer
/// record.
///
/// `pickPhoto`/`uploadPhoto` are both injected — real implementations come from
/// `driver_providers.dart` (`proofOfDeliveryPhotoPickerProvider`), which a widget
/// test overrides with a fake, the same established pattern
/// `driverLocationServiceProvider`/`FakeLocationService` already uses for
/// `Geolocator` (no platform channel in widget tests). This widget itself never
/// imports `image_picker` — CONFIRMED fully pure/host-agnostic.
class ProofOfDeliverySheet extends StatefulWidget {
  const ProofOfDeliverySheet({
    super.key,
    required this.uploadPhoto,
    required this.pickPhoto,
  });

  final Future<String> Function(Uint8List bytes, String filename) uploadPhoto;
  final PickPhotoBytes pickPhoto;

  @override
  State<ProofOfDeliverySheet> createState() => _ProofOfDeliverySheetState();
}

class _ProofOfDeliverySheetState extends State<ProofOfDeliverySheet> {
  final _recipientController = TextEditingController();
  Uint8List? _photoBytes;
  String? _uploadedUrl;
  bool _isUploading = false;
  String? _error;

  Future<void> _pickAndUpload() async {
    setState(() => _error = null);
    final picked = await widget.pickPhoto();
    if (picked == null || !mounted) return;

    setState(() {
      _photoBytes = picked.bytes;
      _uploadedUrl = null;
      _isUploading = true;
    });
    try {
      final url = await widget.uploadPhoto(picked.bytes, picked.filename);
      if (!mounted) return;
      setState(() => _uploadedUrl = url);
    } catch (_) {
      if (mounted) setState(() => _error = context.t('Could not upload the photo. Try again.', 'تعذّر رفع الصورة. حاول مرة أخرى.'));
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  void _confirm() {
    if (_uploadedUrl == null) return;
    final recipientName = _recipientController.text.trim();
    Navigator.of(context).pop(
      ProofOfDeliveryResult(photoUrl: _uploadedUrl!, recipientName: recipientName.isEmpty ? null : recipientName),
    );
  }

  @override
  void dispose() {
    _recipientController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: MediaQuery.of(context).viewInsets.bottom + 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(context.t('Proof of Delivery', 'إثبات التسليم'), style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text(context.t('Take a photo to confirm this delivery.', 'التقط صورة لتأكيد هذا التسليم.')),
          const SizedBox(height: 12),
          if (_photoBytes != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.memory(
                _photoBytes!,
                height: 160,
                width: double.infinity,
                fit: BoxFit.cover,
                // Defensive only — the photo is already durably uploaded by this point
                // (see `_uploadedUrl`); a preview-render failure must never block or
                // crash the Confirm step.
                errorBuilder: (context, error, stackTrace) => Container(
                  height: 160,
                  color: Colors.grey.shade300,
                  alignment: Alignment.center,
                  child: const Icon(Icons.photo, size: 40),
                ),
              ),
            ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            key: const Key('pod-pick-photo'),
            onPressed: _isUploading ? null : _pickAndUpload,
            icon: const Icon(Icons.camera_alt_outlined),
            label: Text(_photoBytes == null ? context.t('Take Photo', 'التقاط صورة') : context.t('Retake Photo', 'إعادة التقاط')),
          ),
          if (_isUploading) const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator()),
          if (_uploadedUrl != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(children: [
                const Icon(Icons.check_circle, color: Colors.green, size: 16),
                const SizedBox(width: 4),
                Text(context.t('Photo uploaded', 'تم رفع الصورة'), style: const TextStyle(color: Colors.green)),
              ]),
            ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('pod-recipient-name'),
            controller: _recipientController,
            decoration: InputDecoration(labelText: context.t('Recipient name (optional)', 'اسم المستلم (اختياري)'), border: const OutlineInputBorder()),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  key: const Key('pod-cancel'),
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(context.t('Cancel', 'إلغاء')),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  key: const Key('pod-confirm'),
                  onPressed: _uploadedUrl != null ? _confirm : null,
                  child: Text(context.t('Confirm Delivered', 'تأكيد التسليم')),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
