import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// The editable twin of [HatlySearchBar]: the same soft-filled look (no border,
/// radius 12, ≥48px tall) but a real text field. Used by Explore, which owns
/// typing; Home keeps the tap-to-open [HatlySearchBar].
class HatlySearchField extends StatelessWidget {
  const HatlySearchField({
    super.key,
    required this.controller,
    required this.hintText,
    required this.onChanged,
    required this.clearTooltip,
    this.autofocus = false,
  });

  final TextEditingController controller;
  final String hintText;
  final ValueChanged<String> onChanged;
  final String clearTooltip;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Material(
      color: p.surfaceSoft,
      borderRadius: BorderRadius.circular(HatlyRadius.searchBar),
      child: Container(
        decoration: BoxDecoration(border: Border.all(color: p.border.withValues(alpha: .55)), borderRadius: BorderRadius.circular(HatlyRadius.searchBar)),
        constraints: const BoxConstraints(minHeight: 52),
        child: Row(
          children: [
            Padding(
              padding: const EdgeInsetsDirectional.only(
                  start: HatlySpacing.md, end: HatlySpacing.ms),
              child: Icon(Icons.search_rounded, color: p.textMuted, size: 22),
            ),
            Expanded(
              child: TextField(
                controller: controller,
                autofocus: autofocus,
                onChanged: onChanged,
                textInputAction: TextInputAction.search,
                style: context.type.body.copyWith(color: p.textPrimary),
                cursorColor: p.accent,
                decoration: InputDecoration(
                  isCollapsed: true,
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  filled: false,
                  contentPadding:
                      const EdgeInsets.symmetric(vertical: HatlySpacing.ms),
                  hintText: hintText,
                  hintStyle: context.type.body.copyWith(color: p.textMuted),
                ),
              ),
            ),
            // Rebuilds with the text so the clear button appears/disappears.
            ValueListenableBuilder<TextEditingValue>(
              valueListenable: controller,
              builder: (context, value, _) => value.text.isEmpty
                  ? const SizedBox(width: HatlySpacing.md)
                  : IconButton(
                      tooltip: clearTooltip,
                      constraints: const BoxConstraints(
                          minWidth: HatlyTouch.minTarget,
                          minHeight: HatlyTouch.minTarget),
                      onPressed: () {
                        controller.clear();
                        onChanged('');
                      },
                      icon: Icon(Icons.close_rounded,
                          size: 20, color: p.textMuted),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
