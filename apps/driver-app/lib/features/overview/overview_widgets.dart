import 'package:flutter/material.dart';
import '../../core/localization/bilingual.dart';

/// A small KPI box for the round-2 tabs (works inside a Wrap — unlike KpiTile, which expands in a Row).
class MiniKpi extends StatelessWidget {
  const MiniKpi({super.key, required this.label, required this.value, this.color, this.width = 104});
  final String label;
  final String value;
  final Color? color;
  final double width;
  @override
  Widget build(BuildContext context) => Container(
        width: width,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(color: const Color(0xFFF4F4F4), borderRadius: BorderRadius.circular(12)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: AlignmentDirectional.centerStart,
            child: Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: color ?? const Color(0xFF1A1A1A))),
          ),
          const SizedBox(height: 2),
          Text(label, maxLines: 2, style: const TextStyle(fontSize: 11, color: Color(0xFF6B6B6B))),
        ]),
      );
}

String two(int v) => v.toString().padLeft(2, '0');
String shortDate(DateTime d) => '${two(d.day)}/${two(d.month)}';
String shortDateTime(DateTime d) => '${shortDate(d)} ${two(d.hour)}:${two(d.minute)}';
String ymd(DateTime d) => '${d.year}-${two(d.month)}-${two(d.day)}';
String prettyYmd(String s) {
  final d = DateTime.tryParse(s);
  return d == null ? s : shortDate(d);
}

/// "5 h 20 min" / "5 س 20 د".
String hoursMinutes(BuildContext context, int minutes) =>
    context.t('${minutes ~/ 60} h ${minutes % 60} min', '${minutes ~/ 60} س ${minutes % 60} د');

/// Order status in the driver's language.
String orderStatusLabel(BuildContext context, String status) {
  switch (status) {
    case 'DELIVERED':
      return context.t('Delivered', 'تم التسليم');
    case 'CANCELLED':
      return context.t('Cancelled', 'ملغي');
    case 'FAILED_DELIVERY':
    case 'RETURNED':
      return context.t('Failed', 'فشل التسليم');
    case 'PICKED_UP':
    case 'ON_THE_WAY':
      return context.t('On the way', 'في الطريق');
    default:
      return context.t('In progress', 'قيد التنفيذ');
  }
}

Color orderStatusColor(String status) {
  switch (status) {
    case 'DELIVERED':
      return const Color(0xFF1B7F3B);
    case 'CANCELLED':
    case 'FAILED_DELIVERY':
    case 'RETURNED':
      return const Color(0xFFB3261E);
    default:
      return const Color(0xFF8D6E00);
  }
}

/// Opens the date-range picker; null when cancelled.
Future<DateTimeRange?> pickRange(BuildContext context, {DateTimeRange? initial}) {
  final now = DateTime.now();
  return showDateRangePicker(
    context: context,
    firstDate: DateTime(now.year - 2),
    lastDate: DateTime(now.year, now.month, now.day),
    initialDateRange: initial,
  );
}
