import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/hatly_theme.dart';

/// A 6-digit code entry that looks like separate boxes but is backed
/// by one real `TextField`. Using a single field (rather than one
/// FocusNode per digit) means OS paste (long-press -> Paste, or
/// Cmd/Ctrl+V) fills all 6 digits at once for free, and autofill
/// from an SMS-code suggestion (where the OS supports it) works the
/// same way — a per-box implementation would need extra plumbing to
/// support either.
class OtpCodeField extends StatefulWidget {
  const OtpCodeField({
    super.key,
    required this.onCompleted,
    required this.onChanged,
    this.length = 6,
    this.autofocus = true,
    this.hasError = false,
  });

  final ValueChanged<String> onCompleted;
  final ValueChanged<String> onChanged;
  final int length;
  final bool autofocus;
  final bool hasError;

  @override
  State<OtpCodeField> createState() => _OtpCodeFieldState();
}

class _OtpCodeFieldState extends State<OtpCodeField> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => _focusNode.requestFocus(),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Digit order stays LTR even inside an RTL layout — this is
          // the standard convention for codes/numbers embedded in
          // Arabic UI (spec section 19 calls out "numbers" as an RTL
          // detail to get right; flipping a 6-digit code's box order
          // under RTL would make it unreadable/mis-enterable).
          Directionality(
            textDirection: TextDirection.ltr,
            child: Row(
              children: List.generate(widget.length, _buildBox),
            ),
          ),
          // Invisible real field that actually receives input/paste/autofill.
          Opacity(
            opacity: 0,
            child: TextField(
              controller: _controller,
              focusNode: _focusNode,
              autofocus: widget.autofocus,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.done,
              autofillHints: const [AutofillHints.oneTimeCode],
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(widget.length),
              ],
              onChanged: (value) {
                widget.onChanged(value);
                setState(() {});
                if (value.length == widget.length) {
                  widget.onCompleted(value);
                }
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBox(int index) {
    final p = context.palette;
    final text = _controller.text;
    final filled = index < text.length;
    final isNextToFill = index == text.length;

    final borderColor = widget.hasError
        ? p.urgent
        : (isNextToFill ? HatlyColors.primaryOrange : p.border);

    // Boxes share the row width (6 equal cells + 8px gaps) instead of a
    // fixed 44px, so they are comfortably large on every phone width.
    return Expanded(
      child: Container(
        height: 56,
        margin: EdgeInsetsDirectional.only(
          end: index == widget.length - 1 ? 0 : HatlySpacing.sm,
        ),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          border: Border.all(color: borderColor, width: isNextToFill ? 2 : 1),
          borderRadius: BorderRadius.circular(HatlyRadius.input),
          color: p.surface,
        ),
        child: Text(
          filled ? text[index] : '',
          style: context.type.h2.copyWith(color: p.textPrimary),
        ),
      ),
    );
  }
}
