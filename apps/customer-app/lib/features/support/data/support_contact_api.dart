import '../../../core/network/api_client.dart';

/// Customer-facing Hatly support contact — `GET /support/contact` (support-contact.controller.ts). Independent of
/// Manual Transfer: it has no destination/payment dependency and never fails just because the number is unset.
class SupportContact {
  const SupportContact({this.whatsappNumber});

  /// Null when no support number is configured (or the value is unusable) — the app then hides the support action.
  final String? whatsappNumber;

  bool get isAvailable => whatsappNumber != null;

  /// Tolerant on purpose: a missing / null / blank / non-string number, or a number with no digits, is simply
  /// "unavailable" — never an exception the customer could see.
  factory SupportContact.fromJson(Map<String, dynamic> json) {
    final raw = json['whatsappNumber'];
    if (raw is! String) return const SupportContact();
    final trimmed = raw.trim();
    if (!RegExp(r'\d').hasMatch(trimmed)) return const SupportContact();
    return SupportContact(whatsappNumber: trimmed);
  }
}

class SupportContactApi {
  SupportContactApi(this._client);

  final ApiClient _client;

  Future<SupportContact> getContact() {
    return _client.request(
      (dio) => dio.get('/support/contact'),
      (data) => SupportContact.fromJson(data['data'] as Map<String, dynamic>),
    );
  }
}
