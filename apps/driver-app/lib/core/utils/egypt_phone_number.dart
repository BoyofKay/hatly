import 'package:flutter/services.dart';

/// Normalizes and validates Egyptian mobile numbers client-side. This
/// is a UX convenience only — the backend re-validates with
/// `class-validator`'s `@IsPhoneNumber('EG')` and remains the actual
/// source of truth (spec: "the backend remains the source of truth").
///
/// Accepts common input shapes a customer might type:
///   01012345678, 1012345678, +201012345678, 00201012345678
/// and normalizes all of them to E.164: +201012345678
class EgyptPhoneNumber {
  /// Valid Egyptian mobile prefixes (post country code, first two
  /// digits after the leading 1): 010, 011, 012, 015.
  static const _validPrefixes = ['10', '11', '12', '15'];

  /// Returns the normalized E.164 form, or null if the input can't be
  /// parsed into a plausible Egyptian mobile number.
  static String? normalize(String rawInput) {
    var digits = asciiDigits(rawInput).trim().replaceAll(RegExp(r'[^0-9+]'), '');

    if (digits.startsWith('+20')) {
      digits = digits.substring(3);
    } else if (digits.startsWith('0020')) {
      digits = digits.substring(4);
    } else if (digits.startsWith('20') && digits.length == 12) {
      digits = digits.substring(2);
    } else if (digits.startsWith('0')) {
      digits = digits.substring(1);
    }

    // At this point `digits` should be the 10-digit national number
    // without the leading 0, e.g. "1012345678".
    if (digits.length != 10) return null;
    if (!_validPrefixes.contains(digits.substring(0, 2))) return null;
    if (!RegExp(r'^\d{10}$').hasMatch(digits)) return null;

    return '+20$digits';
  }

  /// Egypt is the default; explicit international numbers remain supported for existing driver accounts.
  static String? normalizeForAuth(String rawInput) {
    final eg = normalize(rawInput);
    if (eg != null) return eg;
    var value = asciiDigits(rawInput).trim().replaceAll(RegExp(r'[^0-9+]'), '');
    if (value.startsWith('00')) value = '+${value.substring(2)}';
    return !value.startsWith('+20') && RegExp(r'^\+[1-9]\d{6,14} => normalize(rawInput) != null;

  /// True when the customer typed a number with ANOTHER country's calling code (`+966…`, `00971…`). It is never accepted — it only
  /// lets the screen say "Egyptian numbers only" instead of a generic "doesn't look right". A bare national number such as
  /// `0501234567` carries no country code and is treated as an ordinary invalid Egyptian number.
  static bool looksInternational(String rawInput) {
    final digits = asciiDigits(rawInput).replaceAll(RegExp(r'[^0-9+]'), '');
    if (digits.startsWith('+')) return !digits.startsWith('+20');
    if (digits.startsWith('00')) return !digits.startsWith('0020');
    return false;
  }

  /// Arabic-Indic (٠-٩, U+0660–0669) and Extended Arabic-Indic / Persian (۰-۹, U+06F0–06F9) digits — what an Arabic keyboard types —
  /// mapped to ASCII 0-9; every other character is left as it is.
  static String asciiDigits(String input) {
    final out = StringBuffer();
    for (final unit in input.runes) {
      if (unit >= 0x0660 && unit <= 0x0669) {
        out.writeCharCode(0x30 + unit - 0x0660);
      } else if (unit >= 0x06F0 && unit <= 0x06F9) {
        out.writeCharCode(0x30 + unit - 0x06F0);
      } else {
        out.writeCharCode(unit);
      }
    }
    return out.toString();
  }
}
).hasMatch(value) ? value : null;
  }

  static bool isValid(String rawInput) => normalize(rawInput) != null;

  /// True when the customer typed a number with ANOTHER country's calling code (`+966…`, `00971…`). It is never accepted — it only
  /// lets the screen say "Egyptian numbers only" instead of a generic "doesn't look right". A bare national number such as
  /// `0501234567` carries no country code and is treated as an ordinary invalid Egyptian number.
  static bool looksInternational(String rawInput) {
    final digits = asciiDigits(rawInput).replaceAll(RegExp(r'[^0-9+]'), '');
    if (digits.startsWith('+')) return !digits.startsWith('+20');
    if (digits.startsWith('00')) return !digits.startsWith('0020');
    return false;
  }

  /// Arabic-Indic (٠-٩, U+0660–0669) and Extended Arabic-Indic / Persian (۰-۹, U+06F0–06F9) digits — what an Arabic keyboard types —
  /// mapped to ASCII 0-9; every other character is left as it is.
  static String asciiDigits(String input) {
    final out = StringBuffer();
    for (final unit in input.runes) {
      if (unit >= 0x0660 && unit <= 0x0669) {
        out.writeCharCode(0x30 + unit - 0x0660);
      } else if (unit >= 0x06F0 && unit <= 0x06F9) {
        out.writeCharCode(0x30 + unit - 0x06F0);
      } else {
        out.writeCharCode(unit);
      }
    }
    return out.toString();
  }
}

class DriverNationalPhoneFormatter extends TextInputFormatter {
  const DriverNationalPhoneFormatter();
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    var text = EgyptPhoneNumber.asciiDigits(newValue.text).replaceAll(RegExp(r'[^0-9+]'), '');
    if (text.startsWith('+20')) text = text.substring(3);
    else if (text.startsWith('0020')) text = text.substring(4);
    else if (text.startsWith('20') && text.length == 12) text = text.substring(2);
    return TextEditingValue(text: text, selection: TextSelection.collapsed(offset: text.length));
  }
}
