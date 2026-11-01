/// A product of the order turned out to be unavailable after ordering (PD-016). The customer has exactly two answers: continue without the
/// items, or cancel the whole order. There is no replacement to choose. Silence changes nothing.
class UnavailableItem {
  const UnavailableItem({required this.productName, required this.quantity, this.amountMinor});

  final String? productName;
  final int quantity;
  final int? amountMinor;

  factory UnavailableItem.fromJson(Map<String, dynamic> json) => UnavailableItem(
        productName: json['productName'] as String?,
        quantity: (json['quantity'] as num?)?.toInt() ?? 1,
        amountMinor: (json['amountMinor'] as num?)?.toInt(),
      );
}

class ItemUnavailability {
  const ItemUnavailability({required this.id, required this.status, required this.customerDecision, required this.items});

  final String id;

  /// OPEN · AWAITING_CUSTOMER · AWAITING_OPERATIONS · ESCALATED · RESOLVED · WITHDRAWN
  final String status;

  /// CONTINUE_WITHOUT · CANCEL_ORDER · null (not answered yet, or an answer that could not be carried out was cleared).
  final String? customerDecision;
  final List<UnavailableItem> items;

  bool get isClosed => status == 'RESOLVED' || status == 'WITHDRAWN';

  /// The customer still has to answer.
  bool get needsAnswer => !isClosed && customerDecision == null && (status == 'AWAITING_CUSTOMER' || status == 'OPEN' || status == 'ESCALATED');

  /// The customer asked to cancel and Hatly has not executed it yet.
  bool get cancellationRequested => !isClosed && customerDecision == 'CANCEL_ORDER';

  /// Operations took over (the answer could not be carried out automatically, or the case was escalated after an answer).
  bool get operationsHandling => !isClosed && customerDecision == null && status == 'AWAITING_OPERATIONS';

  factory ItemUnavailability.fromJson(Map<String, dynamic> json) => ItemUnavailability(
        id: json['id'] as String,
        status: json['status'] as String,
        customerDecision: json['customerDecision'] as String?,
        items: ((json['items'] as List?) ?? const []).map((e) => UnavailableItem.fromJson(e as Map<String, dynamic>)).toList(),
      );
}

/// An item taken off the order because it was unavailable (kept for the record; it is no longer part of `items`).
class RemovedOrderItem {
  const RemovedOrderItem({required this.id, required this.productName, required this.quantity, this.removedAmountMinor});

  final String id;
  final String? productName;
  final int quantity;
  final int? removedAmountMinor;

  factory RemovedOrderItem.fromJson(Map<String, dynamic> json) => RemovedOrderItem(
        id: json['id'] as String,
        productName: (json['productNameArSnapshot'] as String?) ?? (json['productNameSnapshot'] as String?),
        quantity: (json['quantity'] as num?)?.toInt() ?? 1,
        removedAmountMinor: (json['removedAmountMinor'] as num?)?.toInt(),
      );
}
