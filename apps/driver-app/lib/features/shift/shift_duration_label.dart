import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/localization/bilingual.dart';
import 'shift_api.dart';

/// Live elapsed shift time; based exclusively on the server's current shift
/// start timestamp, not today's date or any inferred clock-in.
class ShiftDurationLabel extends ConsumerStatefulWidget {
  const ShiftDurationLabel({super.key, this.state, this.compact = false});
  final bool compact;
  final ShiftState? state;
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
    final shift = widget.state ?? ref.watch(shiftStateProvider).valueOrNull;
    if (shift == null || !shift.onDuty || shift.startedAt == null) {
      return const SizedBox.shrink();
    }
    // Prefer server-computed elapsed shift minutes. Local device clock skew must
    // not inflate the current-shift duration; the device only advances the
    // server duration from its own read timestamp.
    final minuteAtRead = shift.serverElapsedMinutes;
    final passed = shift.readAt == null ? 0 : DateTime.now().difference(shift.readAt!).inMinutes.clamp(0, 10000000);
    final minutes = (minuteAtRead == null
      ? DateTime.now().difference(shift.startedAt!).inMinutes
      : minuteAtRead + passed).clamp(0, 10000000);
    final hours = minutes ~/ 60;
    final mins = minutes % 60;
    final since = shift.startedAt!.toLocal();
    final sinceText = '${since.day.toString().padLeft(2, '0')}/${since.month.toString().padLeft(2, '0')}/${(since.year % 100).toString().padLeft(2, '0')} ${since.hour.toString().padLeft(2, '0')}:${since.minute.toString().padLeft(2, '0')}';
    return Row(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.schedule_outlined, size: 16, color: Color(0xFF1B5E20)),
      const SizedBox(width: 5),
      Flexible(child: FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
        child: Text(widget.compact ? context.t('${hours}h ${mins}m', '${hours}س ${mins}د') : context.t('Since $sinceText · ${hours}h ${mins}m',
          'منذ $sinceText · ${hours}س ${mins}د'),
          key: const Key('shift-duration'), maxLines: 1,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF1B5E20), decoration: TextDecoration.none)))),
    ]);
  }
}
