import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// Soft-filled search entry (no visible border, radius 12, ≥48px tall).
///
/// It is a *tap target that hands off to the search screen*, not a text field
/// — the existing search architecture (`/search`, `SearchScreen`) owns typing,
/// debouncing and results. Search conceptually covers products, vendors and
/// categories; this widget only presents the entry point.
class HatlySearchBar extends StatelessWidget {
  const HatlySearchBar(
      {super.key, required this.hintText, required this.onTap});

  final String hintText;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Semantics(
      button: true,
      label: hintText,
      onTap: onTap,
      excludeSemantics: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: p.surfaceSoft,
          borderRadius: BorderRadius.circular(HatlyRadius.searchBar),
          border: Border.all(color: p.border.withValues(alpha: .55)),
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: BorderRadius.circular(HatlyRadius.searchBar),
            onTap: onTap,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 52),
              child: Padding(
                padding: const EdgeInsetsDirectional.only(
                    start: HatlySpacing.ms, end: HatlySpacing.md),
                child: Row(
                  children: [
                    Icon(Icons.search_rounded, color: p.textMuted, size: 22),
                    const SizedBox(width: HatlySpacing.ms),
                    Expanded(
                      child: Text(
                        hintText,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.type.body.copyWith(color: p.textMuted),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
