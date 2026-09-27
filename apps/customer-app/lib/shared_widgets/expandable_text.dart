import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// Body text that starts collapsed at [collapsedLines] lines and offers "عرض المزيد" / "عرض أقل" — but
/// only when the text really is longer than that (short text shows no control at all). Expands in place.
class ExpandableText extends StatefulWidget {
  const ExpandableText(
    this.text, {
    super.key,
    required this.moreLabel,
    required this.lessLabel,
    this.style,
    this.collapsedLines = 2,
  });

  final String text;
  final String moreLabel;
  final String lessLabel;
  final TextStyle? style;
  final int collapsedLines;

  @override
  State<ExpandableText> createState() => _ExpandableTextState();
}

class _ExpandableTextState extends State<ExpandableText> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final style =
        widget.style ?? context.type.body.copyWith(color: p.textPrimary);

    return LayoutBuilder(
      builder: (context, constraints) {
        final painter = TextPainter(
          text: TextSpan(text: widget.text, style: style),
          maxLines: widget.collapsedLines,
          textDirection: Directionality.of(context),
          textScaler: MediaQuery.textScalerOf(context),
        )..layout(maxWidth: constraints.maxWidth);
        final overflows = painter.didExceedMaxLines;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AnimatedSize(
              duration: const Duration(milliseconds: 180),
              alignment: AlignmentDirectional.topStart,
              child: Text(
                widget.text,
                style: style,
                maxLines:
                    _expanded || !overflows ? null : widget.collapsedLines,
                overflow: _expanded || !overflows
                    ? TextOverflow.visible
                    : TextOverflow.ellipsis,
              ),
            ),
            if (overflows)
              InkWell(
                borderRadius: BorderRadius.circular(HatlyRadius.chip),
                onTap: () => setState(() => _expanded = !_expanded),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                      minHeight: HatlyTouch.minTarget,
                      minWidth: HatlyTouch.minTarget),
                  child: Align(
                    alignment: AlignmentDirectional.centerStart,
                    widthFactor: 1,
                    child: Text(
                      _expanded ? widget.lessLabel : widget.moreLabel,
                      style: context.type.small
                          .copyWith(color: p.link, fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
