import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/hatly_theme.dart';

/// A phone field that always shows the +20 (Egypt) country code as a
/// fixed prefix — the customer only ever types the national number
/// (e.g. "1012345678" or with the leading 0), never the country code
/// itself, which removes a whole class of "did I need +20 or not"
/// input errors (spec: "clearly indicate Egypt / +20").
///
/// Presentation: one white 12px-radius field with a soft country segment
/// (flag + +20) separated by a hairline divider; the border turns brand
/// orange while the number is focused. Behaviour (digits only, 11 max,
/// controller/autofocus contract) is unchanged.
class EgyptPhoneField extends StatefulWidget {
  const EgyptPhoneField({
    super.key,
    required this.controller,
    required this.autofocus,
  });

  final TextEditingController controller;
  final bool autofocus;

  @override
  State<EgyptPhoneField> createState() => _EgyptPhoneFieldState();
}

class _EgyptPhoneFieldState extends State<EgyptPhoneField> {
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final focused = _focusNode.hasFocus;

    return Directionality(
      // The phone number itself is a numeric/Latin string; keep the
      // input row LTR (prefix chip on the leading edge) regardless of
      // the app's active locale, same rationale as OtpCodeField.
      textDirection: TextDirection.ltr,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        constraints: const BoxConstraints(minHeight: 52),
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(HatlyRadius.input),
          border: Border.all(
            color: focused ? HatlyColors.primaryOrange : p.border,
            width: focused ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: HatlySpacing.md),
              constraints: const BoxConstraints(minHeight: 52),
              decoration: BoxDecoration(
                color: p.surfaceSoft,
                borderRadius: const BorderRadius.horizontal(
                  left: Radius.circular(HatlyRadius.input - 1),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('🇪🇬', style: TextStyle(fontSize: 18)),
                  const SizedBox(width: HatlySpacing.sm),
                  Text(
                    '+20',
                    style: context.type.body.copyWith(
                      fontWeight: FontWeight.w700,
                      color: p.textPrimary,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: TextField(
                controller: widget.controller,
                focusNode: _focusNode,
                autofocus: widget.autofocus,
                keyboardType: TextInputType.phone,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(
                      11), // covers a leading-0 local format too
                ],
                style: context.type.body.copyWith(
                  color: p.textPrimary,
                  fontWeight: FontWeight.w500,
                  letterSpacing: 0.5,
                ),
                decoration: InputDecoration(
                  filled: false,
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  hintText: '10XXXXXXXX',
                  hintStyle: context.type.body.copyWith(color: p.textMuted),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: HatlySpacing.md,
                    vertical: 16,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
