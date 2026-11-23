import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/network/api_client.dart';
import '../../core/network/providers.dart';

/// Driver shifts (owner decision 2026-11-22): "Start shift / End shift" (on duty / off duty) and "take new orders".
class ShiftState {
  const ShiftState({
    required this.onDuty,
    required this.acceptingNewOrders,
    required this.startedAt,
    required this.canEnd,
    required this.endBlockedReason,
    required this.activeOrders,
    required this.unsettledOrders,
  });

  final bool onDuty;
  final bool acceptingNewOrders;
  final DateTime? startedAt;
  final bool canEnd;

  /// HAS_ACTIVE_ORDERS · NOT_SETTLED · NO_OPEN_SHIFT, or null when the driver may end the shift.
  final String? endBlockedReason;
  final int activeOrders;
  final int unsettledOrders;

  factory ShiftState.fromJson(Map<String, dynamic> j) {
    final shift = j['shift'] as Map<String, dynamic>?;
    final canEnd = (j['canEnd'] as Map<String, dynamic>?) ?? const {};
    return ShiftState(
      onDuty: j['onDuty'] == true,
      acceptingNewOrders: j['acceptingNewOrders'] != false,
      startedAt: shift?['startedAt'] is String
          ? DateTime.tryParse(shift!['startedAt'] as String)
          : null,
      canEnd: canEnd['ok'] == true,
      endBlockedReason: canEnd['reason'] as String?,
      activeOrders: (canEnd['activeOrders'] as num?)?.toInt() ?? 0,
      unsettledOrders: (canEnd['unsettledOrders'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Thrown when the server refuses a shift action; [code] is the server's reason (e.g. SHIFT_HAS_ACTIVE_ORDERS, SHIFT_NOT_SETTLED).
class ShiftRefused implements Exception {
  ShiftRefused(this.code);
  final String? code;
}

class ShiftApi {
  ShiftApi(this._apiClient);
  final ApiClient _apiClient;

  /// Null when the server has no shifts (older backend) or cannot be reached — the app then keeps the plain online switch.
  Future<ShiftState?> getShift() async {
    try {
      final r = await _apiClient.dio.get('/driver/shift');
      return ShiftState.fromJson(r.data['data'] as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  Future<ShiftState> start() => _post('/driver/shift/start');
  Future<ShiftState> end() => _post('/driver/shift/end');

  Future<ShiftState> setAcceptingNewOrders(bool accepting) async {
    try {
      final r = await _apiClient.dio.patch('/driver/shift/accepting-new-orders',
          data: {'accepting': accepting});
      return ShiftState.fromJson(r.data['data'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ShiftRefused(_code(e));
    }
  }

  Future<ShiftState> _post(String path) async {
    try {
      final r = await _apiClient.dio.post(path);
      return ShiftState.fromJson(r.data['data'] as Map<String, dynamic>);
    } on DioException catch (e) {
      throw ShiftRefused(_code(e));
    }
  }

  static String? _code(DioException e) {
    final data = e.response?.data;
    if (data is Map && data['error'] is Map)
      return ((data['error'] as Map)['details'] as Map?)?['code'] as String?;
    return null;
  }
}

final shiftApiProvider =
    Provider<ShiftApi>((ref) => ShiftApi(ref.watch(apiClientProvider)));

final shiftStateProvider = FutureProvider.autoDispose<ShiftState?>(
    (ref) => ref.watch(shiftApiProvider).getShift());
