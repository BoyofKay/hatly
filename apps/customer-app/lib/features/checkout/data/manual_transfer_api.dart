import '../../../core/network/api_client.dart';

/// The Hatly transfer destination — from BusinessConfig
/// (`MANUAL_TRANSFER_DESTINATION`), Admin-configured, never invented
/// here. If unset on the backend, `GET /payments/manual-transfer/config`
/// itself fails closed (see `ManualTransferService.getConfig`'s own
/// comment) — this class does not fabricate a fallback value.
class ManualTransferDestination {
  const ManualTransferDestination({
    required this.label,
    required this.phoneOrAccountNumber,
    this.accountName,
  });

  final String label;
  final String phoneOrAccountNumber;
  final String? accountName;

  factory ManualTransferDestination.fromJson(Map<String, dynamic> json) {
    return ManualTransferDestination(
      label: json['label'] as String,
      phoneOrAccountNumber: json['phoneOrAccountNumber'] as String,
      accountName: json['accountName'] as String?,
    );
  }
}

class ManualTransferConfig {
  const ManualTransferConfig(
      {required this.destination, required this.whatsappNumber});

  final ManualTransferDestination destination;
  final String whatsappNumber;

  factory ManualTransferConfig.fromJson(Map<String, dynamic> json) {
    return ManualTransferConfig(
      destination: ManualTransferDestination.fromJson(
          json['destination'] as Map<String, dynamic>),
      whatsappNumber: json['whatsappNumber'] as String,
    );
  }
}

/// Calls the REAL, already-implemented (Phase E) backend endpoints —
/// nothing here is new backend behavior, only the first Flutter client
/// for it. `claimTransfer` is idempotent server-side (repeat calls
/// after the first just return the current state) — this class adds
/// no additional client-side guard on top of that.
class ManualTransferApi {
  ManualTransferApi(this._client);

  final ApiClient _client;

  Future<ManualTransferConfig> getConfig() {
    return _client.request(
      (dio) => dio.get('/payments/manual-transfer/config'),
      (data) =>
          ManualTransferConfig.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// "I've sent the transfer" — moves the Payment from PENDING through
  /// CUSTOMER_CLAIMED_TRANSFER to UNDER_REVIEW (both steps happen
  /// server-side in one call — see `ManualTransferService.claimTransfer`'s
  /// own comment). This does NOT mark the payment as paid — only an
  /// Admin approval does that.
  Future<void> claimTransfer(String orderId) {
    return _client.request<void>(
      (dio) => dio.post('/payments/manual-transfer/orders/$orderId/claim'),
      (data) {},
    );
  }
}
