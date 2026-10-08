import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/loyalty/domain/loyalty_transaction.dart';

/// Mirrors the backend's real response shapes field-for-field — a
/// mismatch here (a renamed/retyped field on either side) would show
/// up as a runtime parse failure in the app, not a compile error, so
/// these are worth locking down explicitly.
void main() {
  group('LoyaltyBalance.fromJson', () {
    test('parses pointsBalance', () {
      final balance = LoyaltyBalance.fromJson({'pointsBalance': 750});
      expect(balance.pointsBalance, 750);
    });
  });

  group('CustomerLoyaltyTransaction.fromJson', () {
    test('parses a full row and derives isCredit correctly', () {
      final tx = CustomerLoyaltyTransaction.fromJson({
        'id': 't1',
        'pointsDelta': 500,
        'type': 'EARNING',
        'orderId': 'order-1',
        'reason': null,
        'createdAt': '2026-01-01T12:00:00.000Z',
      });
      expect(tx.id, 't1');
      expect(tx.pointsDelta, 500);
      expect(tx.type, 'EARNING');
      expect(tx.orderId, 'order-1');
      expect(tx.reason, isNull);
      expect(tx.isCredit, isTrue);
    });

    test('a negative pointsDelta (REDEMPTION/reversal) is never a credit', () {
      final tx = CustomerLoyaltyTransaction.fromJson({
        'id': 't2',
        'pointsDelta': -500,
        'type': 'REDEMPTION',
        'createdAt': '2026-01-01T12:00:00.000Z',
      });
      expect(tx.isCredit, isFalse);
    });
  });

  group('LoyaltyTransactionPage.fromJson', () {
    test('parses data + meta and computes hasMore correctly', () {
      final page = LoyaltyTransactionPage.fromJson({
        'data': [
          {
            'id': 't1',
            'pointsDelta': 100,
            'type': 'EARNING',
            'createdAt': '2026-01-01T12:00:00.000Z',
          },
        ],
        'meta': {'page': 1, 'limit': 20, 'total': 45},
      });
      expect(page.transactions, hasLength(1));
      expect(page.page, 1);
      expect(page.limit, 20);
      expect(page.total, 45);
      expect(page.hasMore, isTrue); // 1*20 < 45
    });

    test('hasMore is false on the last page', () {
      final page = LoyaltyTransactionPage.fromJson({
        'data': const [],
        'meta': {'page': 3, 'limit': 20, 'total': 45},
      });
      expect(page.hasMore, isFalse); // 3*20 >= 45
    });
  });

  group('LoyaltyConversionResult.fromJson', () {
    test('parses every field from a successful conversion response', () {
      final result = LoyaltyConversionResult.fromJson({
        'convertedPoints': 500,
        'walletCreditMinor': 500,
        'pointsBalance': 250,
        'walletBalance': 1500,
      });
      expect(result.convertedPoints, 500);
      expect(result.walletCreditMinor, 500);
      expect(result.pointsBalance, 250);
      expect(result.walletBalance, 1500);
    });
  });
}
