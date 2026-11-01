// Money is whole minor units (piastres). Everything here is integer arithmetic — never a `double` — so a cash amount can never be off by a
// piastre because of floating point.

/// "125.50" (with the currency, in the screen's language). `null` is shown as a dash, never as 0.
String formatMinor(int? minor, {bool arabic = false}) {
  if (minor == null) return '—';
  final negative = minor < 0;
  final abs = negative ? -minor : minor;
  final text = '${negative ? '-' : ''}${abs ~/ 100}.${(abs % 100).toString().padLeft(2, '0')}';
  return arabic ? '$text ج.م' : '$text EGP';
}

/// Minor units from what a person typed in pounds ("40", "40.5", "٤٠٫٥٠", "40,50"), or null when it is not a plain positive amount with at
/// most two decimals.
int? parseEgpToMinor(String input) {
  var s = input.trim();
  if (s.isEmpty) return null;
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  final b = StringBuffer();
  for (final rune in s.runes) {
    final ch = String.fromCharCode(rune);
    final i = arabicDigits.indexOf(ch);
    b.write(i >= 0 ? '$i' : (ch == '٫' || ch == ',' ? '.' : ch));
  }
  s = b.toString();
  final m = RegExp(r'^(\d{1,9})(?:\.(\d{1,2}))?$').firstMatch(s);
  if (m == null) return null;
  final minor = int.parse(m.group(1)!) * 100 + int.parse((m.group(2) ?? '').padRight(2, '0'));
  return minor > 0 ? minor : null;
}

/// "1.5 kg" / "250 g" from whole grams (integer arithmetic).
String formatGrams(int grams, {bool arabic = false}) {
  if (grams < 1000) return arabic ? '$grams جم' : '$grams g';
  final whole = grams ~/ 1000;
  final frac = (grams % 1000).toString().padLeft(3, '0').replaceFirst(RegExp(r'0+$'), '');
  final kg = frac.isEmpty ? '$whole' : '$whole.$frac';
  return arabic ? '$kg كجم' : '$kg kg';
}
