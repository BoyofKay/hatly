import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// Filters V1 — the "فلترة" (Filter) action shared by the Vendor List
/// and Product List screens. Mirrors `SortMenuButton`'s own compact
/// pill styling exactly (same surface color/radius/icon-plus-label
/// shape) so the two controls read as one consistent pair, never two
/// different visual languages. Shows a small badge with the real
/// active-filter count when non-zero — never a decorative/fake count.
class FilterActionButton extends StatelessWidget {
  const FilterActionButton({
    super.key,
    required this.label,
    required this.activeCount,
    required this.onTap,
  });

  final String label;
  final int activeCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Semantics(
      button: true,
      label: activeCount > 0 ? '$label ($activeCount)' : label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: activeCount > 0 ? p.accentSoft : p.surfaceSoft,
            borderRadius: BorderRadius.circular(20),
            border: activeCount > 0 ? Border.all(color: p.accent) : null,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.tune_rounded,
                  size: 16, color: activeCount > 0 ? p.accent : p.textPrimary),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: activeCount > 0 ? p.accent : p.textPrimary,
                ),
              ),
              if (activeCount > 0) ...[
                const SizedBox(width: 4),
                CircleAvatar(
                  radius: 8,
                  backgroundColor: p.accent,
                  child: Text(
                    '$activeCount',
                    // Polish pass: was hardcoded `Colors.white` on the brand-orange
                    // fill — 2.6:1 contrast, fails accessibility. `p.accentOn` is
                    // the correct dark ink (7:1) for new components.
                    style: TextStyle(
                        fontSize: 10,
                        color: p.accentOn,
                        fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
