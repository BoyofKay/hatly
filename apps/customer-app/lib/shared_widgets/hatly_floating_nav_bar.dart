import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

class HatlyNavItem {
  const HatlyNavItem({
    required this.label,
    required this.icon,
    required this.activeIcon,
    this.badgeCount = 0,
    this.key,
  });

  final String label;
  final IconData icon;
  final IconData activeIcon;

  /// Shown as a small count bubble when > 0 (e.g. cart items).
  final int badgeCount;
  final Key? key;
}

/// Bottom navigation (reference board): a flat, full-width white bar with a
/// hairline top border. The active item is orange — filled icon, orange label
/// and a short orange indicator above the icon — so state is never colour-only
/// (the icon shape and the indicator change too). Each item is ≥44px in both
/// dimensions. (The class keeps its historical name; it no longer floats.)
///
/// Presentation only — it knows nothing about routes. [selectedIndex] may be
/// null when the current destination is not one of the items (e.g. Cart is a
/// pushed route, so it is never "selected" here).
class HatlyFloatingNavBar extends StatelessWidget {
  const HatlyFloatingNavBar(
      {super.key,
      required this.items,
      required this.selectedIndex,
      required this.onTap});

  final List<HatlyNavItem> items;
  final int? selectedIndex;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: p.surface,
        border: Border(top: BorderSide(color: p.border)),
        boxShadow: [
          BoxShadow(
              color: p.shadow.withValues(alpha: 0.04),
              blurRadius: 12,
              offset: const Offset(0, -2)),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
              HatlySpacing.xs, 0, HatlySpacing.xs, HatlySpacing.sm),
          child: Row(
            children: [
              for (var i = 0; i < items.length; i++)
                Expanded(
                  child: _NavButton(
                      item: items[i],
                      selected: selectedIndex == i,
                      onTap: () => onTap(i)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton(
      {required this.item, required this.selected, required this.onTap});

  final HatlyNavItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final color = selected ? p.link : p.textMuted;

    return Semantics(
      button: true,
      selected: selected,
      label: item.label,
      onTap: onTap,
      excludeSemantics: true,
      child: InkWell(
        key: item.key,
        borderRadius: BorderRadius.circular(HatlyRadius.circular),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(
              minHeight: 52, minWidth: HatlyTouch.minTarget),
          // heightFactor: 1 — a plain Center would expand to the full height that a
          // Scaffold's bottomNavigationBar slot offers (loose constraints).
          child: Center(
            heightFactor: 1,
            child: Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    width: selected ? 24 : 0,
                    height: 3,
                    margin: const EdgeInsets.only(bottom: 6),
                    decoration: BoxDecoration(
                      color: p.accent,
                      borderRadius: const BorderRadius.vertical(
                          bottom: Radius.circular(3)),
                    ),
                  ),
                  Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Icon(selected ? item.activeIcon : item.icon,
                          size: 24, color: color),
                      if (item.badgeCount > 0)
                        PositionedDirectional(
                          top: -4,
                          end: -8,
                          child: Container(
                            constraints: const BoxConstraints(
                                minWidth: 16, minHeight: 16),
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                                color: p.accent,
                                borderRadius: BorderRadius.circular(8)),
                            child: Directionality(
                              textDirection: TextDirection.ltr,
                              child: Text(
                                item.badgeCount > 99
                                    ? '99+'
                                    : '${item.badgeCount}',
                                style: TextStyle(
                                    color: p.accentOn,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w800),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    item.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: context.type.caption.copyWith(
                      color: color,
                      fontWeight: selected ? FontWeight.w800 : FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
