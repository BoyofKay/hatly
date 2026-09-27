import 'dart:async';

import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/orders/data/orders_api.dart';
import 'package:hatly_customer/features/orders/domain/order_details.dart';
import 'package:hatly_customer/features/orders/domain/order_summary.dart';
import 'package:hatly_customer/features/orders/domain/order_tracking.dart';

import 'order_fixtures.dart';

/// In-memory orders backend: per-tab lists, details, tracking and customer cancellation.
class FakeOrdersReadApi implements OrdersApi {
  FakeOrdersReadApi({
    Map<OrderListTab, List<Map<String, dynamic>>>? lists,
    Map<String, dynamic>? details,
    Map<String, dynamic>? tracking,
  })  : lists = lists ?? {},
        details = details ?? orderDetailsJson(),
        tracking = tracking ?? trackingJson();

  final Map<OrderListTab, List<Map<String, dynamic>>> lists;
  Map<String, dynamic> details;
  Map<String, dynamic> tracking;

  final listCalls = <OrderListTab?>[];
  final cancelCalls = <({String orderId, String? reason})>[];
  ApiException? cancelFailure;
  Object? detailsFailure;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<OrderHistoryPage> getOrders(
      {int page = 1, int limit = 20, String? status, OrderListTab? tab}) async {
    listCalls.add(tab);
    final rows = lists[tab] ?? const [];
    return OrderHistoryPage.fromJson({
      'data': rows,
      'meta': {'page': page, 'limit': limit, 'total': rows.length},
    });
  }

  @override
  Future<OrderDetails> getOrderDetails(String orderId) async {
    if (detailsFailure != null) throw detailsFailure!;
    return OrderDetails.fromJson(details);
  }

  @override
  Future<OrderTracking> getTracking(String orderId) async =>
      OrderTracking.fromJson(tracking);

  @override
  Future<OrderDetails> cancelOrder(String orderId, {String? reason}) async {
    cancelCalls.add((orderId: orderId, reason: reason));
    if (cancelFailure != null) throw cancelFailure!;
    details = orderDetailsJson(status: 'CANCELLED', canCancel: false);
    return OrderDetails.fromJson(details);
  }
}
