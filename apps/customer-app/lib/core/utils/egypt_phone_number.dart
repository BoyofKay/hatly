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
    var digits = rawInput.trim().replaceAll(RegExp(r'[^0-9+]'), '');

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

  static bool isValid(String rawInput) => normalize(rawInput) != null;
}
