import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/localization/bilingual.dart';
import 'shift_api.dart';

/// Live elapsed shift time; based exclusively on the server's current shift
/// start timestamp, not today's date or any inferred clock-in.
class ShiftDurationLabel extends ConsumerStatefulWidget {
  const ShiftDurationLabel({super.key});
  @override
  ConsumerState<ShiftDurationLabel> createState() => _ShiftDurationLabelState();
}

class _ShiftDurationLabelState extends ConsumerState<ShiftDurationLabel> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final shift = ref.watch(shiftStateProvider).valueOrNull;
    if (shift == null || !shift.onDuty || shift.startedAt == null) {
      return const SizedBox.shrink();
    }
    final minutes = DateTime.now().difference(shift.startedAt!).inMinutes.clamp(0, 10000000);
    final hours = minutes ~/ 60;
    final mins = minutes % 60;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.schedule_outlined, size: 16, color: Color(0xFF6B6B6B)),
        const SizedBox(width: 6),
        Text(
          context.t('Shift duration: ${hours} h ${mins} min', 'مدة الوردية: ${hours} س ${mins} د'),
          key: const Key('shift-duration'),
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF424242)),
        ),
      ]),
    );
  }
}
