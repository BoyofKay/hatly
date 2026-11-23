import 'package:flutter/widgets.dart';

/// Greys out (and slightly fades) its child — used for closed stores (owner request 2026-11-23: "closed with a greyed card").
class Greyscale extends StatelessWidget {
  const Greyscale({super.key, required this.enabled, required this.child});

  final bool enabled;
  final Widget child;

  static const _matrix = <double>[
    0.2126, 0.7152, 0.0722, 0, 0, //
    0.2126, 0.7152, 0.0722, 0, 0, //
    0.2126, 0.7152, 0.0722, 0, 0, //
    0, 0, 0, 0.6, 0,
  ];

  @override
  Widget build(BuildContext context) => enabled
      ? ColorFiltered(
          colorFilter: const ColorFilter.matrix(_matrix), child: child)
      : child;
}
