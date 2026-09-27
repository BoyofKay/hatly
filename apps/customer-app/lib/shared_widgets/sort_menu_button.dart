import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// A single, small reusable sort control — used by both the
/// marketplace Vendor List screen and the vendor's own product menu
/// (Discovery & Ranking phase). Purely a display/selection widget: it
/// never computes a ranking itself — the caller passes the resulting
/// value straight through to the real backend query (`sort=...`). The
/// backend remains the sole source of truth for ordering.
class SortMenuButton extends StatelessWidget {
  const SortMenuButton({
    super.key,
    required this.value,
    required this.options,
    required this.onChanged,
    required this.label,
  });

  /// Null means "no explicit sort" (the backend's own default —
  /// currently Newest).
  final String? value;

  /// (sortValue, displayLabel) pairs, in display order.
  final List<(String, String)> options;
  final ValueChanged<String?> onChanged;
  final String label;

  @override
  Widget build(BuildContext context) {
    final selectedLabel = options
        .firstWhere(
          (o) => o.$1 == value,
          orElse: () => ('', label),
        )
        .$2;

    return PopupMenuButton<String?>(
      initialValue: value,
      onSelected: onChanged,
      itemBuilder: (context) => [
        for (final option in options)
          PopupMenuItem<String?>(
            value: option.$1,
            child: Text(option.$2),
          ),
      ],
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.grey.shade100,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.sort_rounded,
                size: 16, color: HatlyColors.textDark),
            const SizedBox(width: 6),
            Text(
              selectedLabel,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
    );
  }
}
