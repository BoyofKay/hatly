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

class _ShiftDurationLabelState extends ConsumerState<ShiftDurationLabel> with WidgetsBindingObserver {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _ticker = Timer.periodic(const Duration(seconds: 30), (_) {
      if (!mounted) return;
      if (widget.compact) ref.invalidate(shiftStateProvider);
      setState(() {});
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (mounted && widget.compact && state == AppLifecycleState.resumed) ref.invalidate(shiftStateProvider);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
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
    final minutes = elapsedShiftMinutes(shift);
    final color = shiftWarningColor(minutes);
    final hours = minutes ~/ 60;
    final mins = minutes % 60;
    final since = shift.startedAt!.toLocal();
    final sinceText = '${since.day.toString().padLeft(2, '0')}/${since.month.toString().padLeft(2, '0')}/${(since.year % 100).toString().padLeft(2, '0')} ${since.hour.toString().padLeft(2, '0')}:${since.minute.toString().padLeft(2, '0')}';
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(minutes >= 840 ? Icons.warning_amber_rounded : Icons.schedule_outlined, size: 16, color: color),
      const SizedBox(width: 5),
      Flexible(child: FittedBox(fit: BoxFit.scaleDown, alignment: AlignmentDirectional.centerStart,
        child: Text(widget.compact ? context.t('${hours}h ${mins}m', '${hours}س ${mins}د') : context.t('Since $sinceText · ${hours}h ${mins}m',
          'منذ $sinceText · ${hours}س ${mins}د'),
          key: const Key('shift-duration'), maxLines: 1,
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: color, decoration: TextDecoration.none)))),
    ]);
  }
}

int elapsedShiftMinutes(ShiftState shift, {DateTime? now}) {
  final at = now ?? DateTime.now();
  final base = shift.serverElapsedMinutes;
  final passed = shift.readAt == null ? 0 : at.difference(shift.readAt!).inMinutes.clamp(0, 10000000);
  return (base == null ? (shift.startedAt == null ? 0 : at.difference(shift.startedAt!).inMinutes) : base + passed).clamp(0, 10000000).toInt();
}
Color shiftWarningColor(int minutes) => minutes >= 1080 ? const Color(0xFFB52A2A)
    : minutes >= 840 ? const Color(0xFF9B650A) : const Color(0xFF1B5E20);
