import '../../../core/network/api_client.dart';
import '../domain/delivery.dart';

/// Calls the real backend `driver/*` endpoints exactly. CONFIRMED
/// (locked decision): no Accept/Reject method exists here — only the
/// approved lifecycle actions.
class DriverApi {
  DriverApi(this._apiClient);

  final ApiClient _apiClient;

  Future<void> setOnlineStatus(bool isOnline) async {
    await _apiClient.dio.patch('/driver/online-status', data: {'isOnline': isOnline});
  }

  Future<void> updateLocation({required double latitude, required double longitude}) async {
    await _apiClient.dio.patch('/driver/location', data: {'latitude': latitude, 'longitude': longitude});
  }

  Future<List<Delivery>> listDeliveries() async {
    final response = await _apiClient.dio.get('/driver/deliveries');
    return (response.data['data'] as List).map((e) => Delivery.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Delivery> getDelivery(String id) async {
    final response = await _apiClient.dio.get('/driver/deliveries/$id');
    return Delivery.fromJson(response.data['data'] as Map<String, dynamic>);
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
  Future<void> updateDeliveryStatus(String deliveryId, String status, {DriverFailedDeliveryReason? failureReason}) async {
    await _apiClient.dio.patch('/driver/deliveries/$deliveryId/status', data: {
      'status': status,
      if (failureReason != null) 'failureReason': failureReason.wireValue,
    });
  }

  Future<void> recordWeight(String orderItemId, int weightGrams) async {
    await _apiClient.dio.post('/driver/order-items/$orderItemId/weight', data: {'weightGrams': weightGrams});
  }

  Future<void> recordPurchaseAmount(String orderItemId, int amountMinor) async {
    await _apiClient.dio.post('/driver/order-items/$orderItemId/purchase-amount', data: {'amountMinor': amountMinor});
  }
}
