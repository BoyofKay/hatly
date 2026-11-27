import 'dart:convert';
import '../../../core/network/api_client.dart';

/// Vendor/Pharmacy Custom Request (Customer App). Calls the real
/// `POST /uploads` endpoint (uploads.controller.ts) — base64-encoded
/// content in, a real Hatly-hosted URL back. This URL is what
/// CartApi.addVendorCustomItem's `imageUrls` expects; the backend
/// cross-validates every submitted URL against this same Upload
/// table (ownership check), so a URL from anywhere else is rejected
/// there, not here.
class UploadsApi {
  UploadsApi(this._client);

  final ApiClient _client;

  Future<String> uploadImage(List<int> bytes, String filename) {
    final base64Content = base64Encode(bytes);
    return _client.request(
      (dio) => dio.post('/uploads',
          data: {'base64Content': base64Content, 'filename': filename}),
      (data) => (data['data'] as Map<String, dynamic>)['url'] as String,
    );
  }

  /// A voice note (up to 5 minutes) for a Hatly / Wasaly request — `POST /uploads/audio`; the server checks the audio type itself.
  Future<String> uploadAudio(List<int> bytes) {
    return _client.request(
      (dio) => dio.post('/uploads/audio', data: {'base64Content': base64Encode(bytes)}),
      (data) => (data['data'] as Map<String, dynamic>)['url'] as String,
    );
  }
}
