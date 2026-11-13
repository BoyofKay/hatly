import 'dart:convert';
import '../../../core/network/api_client.dart';
import 'package:dio/dio.dart';
import '../../earnings/domain/earnings.dart';
import '../domain/delivery.dart';

/// Calls the real backend `driver/*` endpoints exactly. CONFIRMED
/// (locked decision): no Accept/Reject method exists here — only the
/// approved lifecycle actions.
class DriverApi {
  DriverApi(this._apiClient);

  final ApiClient _apiClient;

  /// A request that failed because of the connection itself (no response at all, a timeout) — the only kind worth repeating automatically.
  static bool isTransient(Object error) =>
      error is DioException &&
      (error.type == DioExceptionType.connectionError ||
          error.type == DioExceptionType.connectionTimeout ||
          error.type == DioExceptionType.sendTimeout ||
          error.type == DioExceptionType.receiveTimeout);

  /// Repeats [op] after a short pause when the CONNECTION failed. Used only for reads and for status changes — the server treats a repeated
  /// status change as a no-op, so repeating can never apply it twice. Weight and purchase amounts are NOT retried this way.
  Future<T> retryTransient<T>(Future<T> Function() op, {int attempts = 3, Duration pause = const Duration(milliseconds: 800)}) async {
    for (var i = 1;; i++) {
      try {
        return await op();
      } catch (e) {
        if (i >= attempts || !isTransient(e)) rethrow;
        await Future<void>.delayed(pause * i);
      }
    }
  }

  Future<void> setOnlineStatus(bool isOnline) async {
    await _apiClient.dio.patch('/driver/online-status', data: {'isOnline': isOnline});
  }

  Future<void> updateLocation({required double latitude, required double longitude}) async {
    await _apiClient.dio.patch('/driver/location', data: {'latitude': latitude, 'longitude': longitude});
  }

  Future<DriverEarnings> getEarnings() async {
    final response = await retryTransient(() => _apiClient.dio.get('/driver/earnings'));
    return DriverEarnings.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  Future<TransactionsPage> getTransactions({int page = 1, int limit = 20}) async {
    final response = await retryTransient(() => _apiClient.dio.get('/driver/transactions', queryParameters: {'page': page, 'limit': limit}));
    final meta = response.data['meta'] as Map<String, dynamic>;
    return TransactionsPage(
      items: (response.data['data'] as List).map((e) => DriverTransaction.fromJson(e as Map<String, dynamic>)).toList(),
      page: (meta['page'] as num).toInt(),
      limit: (meta['limit'] as num).toInt(),
      total: (meta['total'] as num).toInt(),
    );
  }

  /// The orders that still need the driver (`scope=active`, decided by the server). The result is also filtered to the active order states
  /// on the phone — an older backend ignores `scope` and returns finished orders too, which must never appear as active.
  Future<List<Delivery>> listDeliveries() async {
    final response = await retryTransient(() => _apiClient.dio.get('/driver/deliveries', queryParameters: {'scope': 'active'}));
    return (response.data['data'] as List).map((e) => Delivery.fromJson(e as Map<String, dynamic>)).where((d) => d.isActive).toList();
  }

  Future<Delivery> getDelivery(String id) async {
    final response = await retryTransient(() => _apiClient.dio.get('/driver/deliveries/$id'));
    return Delivery.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  /// R16: the driver confirms having seen the assignment (no accept/reject exists). Safe to repeat: the first confirmation is kept.
  Future<Delivery> acknowledgeDelivery(String id) async {
    final response = await retryTransient(() => _apiClient.dio.post('/driver/deliveries/$id/acknowledge'));
    return Delivery.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  /// R17: the Operations phone number drivers call with a problem (null = not configured; the app hides the button).
  Future<String?> getOperationsPhone() async {
    final response = await retryTransient(() => _apiClient.dio.get('/driver/support-contact'));
    final phone = (response.data['data'] as Map<String, dynamic>?)?['operationsPhone'] as String?;
    return phone == null || phone.trim().isEmpty ? null : phone.trim();
  }

  /// `status` is one of the approved Order-level lifecycle targets
  /// (`PICKED_UP`, `ON_THE_WAY`, `DELIVERED`, `FAILED_DELIVERY`) —
  /// CONFIRMED: never `ASSIGNED_TO_DRIVER` (that's an Admin/system
  /// action, not something the driver sets) and never an
  /// Accept/Reject value, since neither exists. The backend's own
  /// transition table is the sole authority regardless of what's sent.
  ///
  /// Driver Core + Dispatch Foundation milestone (amends the prior "the Driver does not provide a
  /// failure reason" note above): `failureReason` is now collected for `FAILED_DELIVERY`, from the
  /// controlled `DriverFailedDeliveryReason` list only — the backend rejects anything else with
  /// `INVALID_FAILURE_REASON`. Still optional at the wire level (omitting it remains valid), but the
  /// UI (see `delivery_detail_screen.dart`) always asks for one before submitting.
  /// M4 — Proof of Delivery. `proofPhotoUrl`/`recipientName` are REQUIRED (by the
  /// backend) when `status == 'DELIVERED'` — see `ProofOfDeliveryScreen`/
  /// `delivery_detail_screen.dart`'s own `_completeDelivery` for the capture flow.
  /// Ignored (never sent) for any other status.
  Future<void> updateDeliveryStatus(
    String deliveryId,
    String status, {
    DriverFailedDeliveryReason? failureReason,
    String? proofPhotoUrl,
    String? recipientName,
  }) async {
    await retryTransient(() => _apiClient.dio.patch('/driver/deliveries/$deliveryId/status', data: {
          'status': status,
          if (failureReason != null) 'failureReason': failureReason.wireValue,
          if (proofPhotoUrl != null) 'proofPhotoUrl': proofPhotoUrl,
          if (recipientName != null) 'recipientName': recipientName,
        }));
  }

  Future<void> recordWeight(String orderItemId, int weightGrams) async {
    await _apiClient.dio.post('/driver/order-items/$orderItemId/weight', data: {'weightGrams': weightGrams});
  }

  Future<void> recordPurchaseAmount(String orderItemId, int amountMinor) async {
    await _apiClient.dio.post('/driver/order-items/$orderItemId/purchase-amount', data: {'amountMinor': amountMinor});
  }

  /// M4 — Proof of Delivery. Uploads a photo through the existing, generic Hatly
  /// uploads endpoint (`POST /uploads` — the same one the Customer app already uses
  /// for prescription/custom-item photos) and returns its real, owned URL. The
  /// DELIVERED transition later verifies server-side that this URL was really
  /// uploaded by this driver — never trusts a client-asserted URL.
  Future<String> uploadProofPhoto(List<int> bytes, String filename) async {
    final response = await _apiClient.dio.post('/uploads', data: {
      'base64Content': base64Encode(bytes),
      'filename': filename,
    });
    return (response.data['data'] as Map<String, dynamic>)['url'] as String;
  }

  /// M4 — Cash remainder / over-collection. Only called when the customer paid
  /// MORE in cash than `amountDueMinor` — the backend itself refuses a submission
  /// with no real remainder (`NO_REMAINDER`), so the UI (see `CashCollectionSheet`)
  /// never calls this for exact change. Idempotent server-side per delivery/order —
  /// a retried submission (e.g. a flaky connection) safely returns the same claim.
  Future<void> submitCashRemainder(String deliveryId, int cashReceivedMinor) async {
    await _apiClient.dio.post('/driver/deliveries/$deliveryId/cash-remainder', data: {
      'cashReceivedMinor': cashReceivedMinor,
    });
  }
}
