import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/push/notification_deep_link.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/features/orders/presentation/order_status_label.dart';

import '../../support/test_app.dart';

/// U2 (approved): COLLECTED — a pickup order the customer collected at the branch — is a completed order: its own label
/// (never "Delivered"), the same "success" colour as DELIVERED, and its push is a routable order notification.
void main() {
  for (final (locale, label) in [
    (const Locale('ar'), 'تم الاستلام'),
    (const Locale('en'), 'Collected'),
  ]) {
    testWidgets(
        'COLLECTED reads "$label" in ${locale.languageCode}, in the completed colour',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(
          const Center(child: OrderStatusBadge(status: 'COLLECTED')),
          locale: locale));
      await tester.pumpAndSettle();
      final text = tester.widget<Text>(find.text(label));
      expect(text.style?.color, HatlyPalette.light.success);
      expect(
          find.text(locale.languageCode == 'ar' ? 'تم التوصيل' : 'Delivered'),
          findsNothing);
    });
  }

  test('the ORDER_COLLECTED push opens the order', () {
    final link = parseNotificationDeepLink({
      'type': 'ORDER_COLLECTED',
      'orderId': '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab'
    });
    expect(link, isNotNull);
    expect(notificationDeepLinkRoute(link!),
        '/orders/3f2b8c1e-aaaa-bbbb-cccc-1234567890ab');
  });
}
