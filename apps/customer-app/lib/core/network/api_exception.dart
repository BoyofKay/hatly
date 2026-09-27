import 'package:dio/dio.dart';

/// Mirrors the backend's error envelope exactly:
///   { "error": { "code": "...", "message": "...", "details": {...} } }
///
/// UI code must branch on [code] (a stable machine-readable string),
/// never on [message] — message may be replaced with a localized
/// string in the UI layer and shouldn't be trusted as a switch key.
/// See hatly-api-contract.md.
class ApiException implements Exception {
  const ApiException(
      {required this.code,
      required this.message,
      this.details,
      this.statusCode});

  final String code;
  final String message;
  final dynamic details;
  final int? statusCode;

  /// Some endpoints (cart mutations especially — see cart.service.ts on
  /// the backend) nest a more specific machine-readable code inside
  /// `details.code`, e.g. `PRODUCT_UNAVAILABLE` or
  /// `CART_BRANCH_CONFLICT`, since the top-level [code] is only the
  /// generic HTTP status name (`BAD_REQUEST`, `CONFLICT`, ...). UI
  /// code that needs to distinguish between different reasons for the
  /// same HTTP status should switch on this, falling back to [code].
  String? get businessCode {
    final d = details;
    if (d is Map && d['code'] is String) return d['code'] as String;
    return null;
  }

  factory ApiException.fromDioError(DioException error) {
    final response = error.response;
    final data = response?.data;

    if (data is Map && data['error'] is Map) {
      final errorBody = data['error'] as Map;
      return ApiException(
        code: (errorBody['code'] as String?) ?? 'UNKNOWN_ERROR',
        message: (errorBody['message'] as String?) ?? 'Something went wrong.',
        details: errorBody['details'],
        statusCode: response?.statusCode,
      );
    }

    // Network-level failure (no response at all: offline, timeout, DNS, etc.)
    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.connectionError) {
      return const ApiException(
          code: 'NETWORK_ERROR', message: 'No connection.');
    }

    return ApiException(
      code: 'UNKNOWN_ERROR',
      message: 'Something went wrong.',
      statusCode: response?.statusCode,
    );
  }
}
