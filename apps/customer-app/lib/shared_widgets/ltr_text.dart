import 'package:flutter/material.dart';

/// Forces left-to-right rendering for a piece of text that is
/// numeric/Latin in nature (prices, ratings, ETAs, counts) even inside
/// an Arabic RTL layout — same rationale as the OTP/phone fields from
/// Phase 2A: reversing digit order under ambient RTL makes numbers
/// unreadable. Spec (2B, RTL section): "Numbers ... must remain LTR."
///
/// This is the reusable version of the pattern first written ad hoc in
/// otp_code_field.dart / egypt_phone_field.dart — centralizing it here
/// since Phase 2B needs it in several more places (ratings, ETAs,
/// prices on vendor cards).
class LtrText extends StatelessWidget {
  const LtrText(this.text,
      {super.key, this.style, this.textAlign, this.maxLines, this.overflow});

  final String text;
  final TextStyle? style;
  final TextAlign? textAlign;
  final int? maxLines;
  final TextOverflow? overflow;

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Text(text,
          style: style,
          textAlign: textAlign,
          maxLines: maxLines,
          overflow: overflow),
    );
  }
}
