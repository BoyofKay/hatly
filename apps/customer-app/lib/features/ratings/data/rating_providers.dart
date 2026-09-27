import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import 'rating_api.dart';

final ratingApiProvider =
    Provider<RatingApi>((ref) => RatingApi(ref.watch(apiClientProvider)));

/// Keyed by orderId, same `.family` pattern as `orderDetailsProvider` —
/// loads independently from the order details themselves, so a
/// rating-state failure never blocks the rest of Order Details from
/// rendering (Section 10's "do not block the entire page").
/// `autoDispose` so re-opening the same order later re-fetches fresh
/// state rather than showing stale already-rated flags.
final orderRatingStateProvider =
    FutureProvider.autoDispose.family<OrderRatingState, String>((ref, orderId) {
  return ref.watch(ratingApiProvider).getOrderRatingState(orderId);
});
