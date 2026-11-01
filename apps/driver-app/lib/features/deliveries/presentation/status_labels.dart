import 'package:flutter/material.dart';
import '../../../core/localization/bilingual.dart';

/// The driver-facing words for an order status (English / Arabic), plus the colour that goes with it. The raw enum is never shown.
String statusLabel(BuildContext context, String status) {
  switch (status) {
    case 'ASSIGNED_TO_DRIVER':
      return context.t('Assigned', 'مُسند إليك');
    case 'PICKED_UP':
      return context.t('Picked up', 'تم الاستلام');
    case 'ON_THE_WAY':
      return context.t('On the way', 'في الطريق');
    case 'DELIVERED':
      return context.t('Delivered', 'تم التسليم');
    case 'FAILED_DELIVERY':
      return context.t('Failed delivery', 'توصيل فاشل');
    case 'READY_FOR_PICKUP':
      return context.t('Ready for pickup', 'جاهز للاستلام');
    case 'CANCELLED':
      return context.t('Cancelled', 'ملغى');
    default:
      return status.replaceAll('_', ' ');
  }
}

Color statusColor(String status) {
  switch (status) {
    case 'DELIVERED':
      return const Color(0xFF2E7D32);
    case 'FAILED_DELIVERY':
    case 'CANCELLED':
      return const Color(0xFFD32F2F);
    case 'ON_THE_WAY':
    case 'PICKED_UP':
      return const Color(0xFF1565C0);
    default:
      return const Color(0xFFE0650A);
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});
  final String status;

  @override
  Widget build(BuildContext context) {
    final color = statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(statusLabel(context, status), style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 12.5)),
    );
  }
}
