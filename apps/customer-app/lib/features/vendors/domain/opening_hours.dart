import '../../../core/localization/l10n/app_localizations.dart';
import 'vendor_branch_summary.dart';

/// Weekly working hours as the server sends them: `{ mon: { open: '12:00', close: '02:00' }, … }`. Anything malformed is skipped;
/// an empty map means the store has no hour limit (the server's rule — see backend common/branch-availability.ts).
Map<String, OpeningHoursRange> openingHoursFromJson(Object? json) {
  if (json is! Map) return const {};
  final out = <String, OpeningHoursRange>{};
  json.forEach((day, v) {
    if (v is Map && v['open'] is String && v['close'] is String) {
      out['$day'] = OpeningHoursRange(
          open: v['open'] as String, close: v['close'] as String);
    }
  });
  return out;
}

const _dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/// Today's day key ('mon'…'sun') for [now] (device time — Hatly's customers are in Egypt, like the stores).
String todayKey([DateTime? now]) =>
    _dayKeys[(now ?? DateTime.now()).weekday - 1];

/// Today's working hours for a card or a popup: "12:00–02:00", "Open 24 hours", "Closed today" — or null when the store has no
/// hours set (nothing to show). The times are wrapped left-to-right so they read correctly inside Arabic text.
String? todayHoursLabel(
    Map<String, OpeningHoursRange> hours, AppLocalizations l10n,
    {DateTime? now}) {
  if (hours.isEmpty) return null;
  final today = hours[todayKey(now)];
  if (today == null) return l10n.vendorClosedToday;
  if (today.open == today.close) return l10n.vendorOpen24Hours;
  return '\u2066${today.open}–${today.close}\u2069';
}
