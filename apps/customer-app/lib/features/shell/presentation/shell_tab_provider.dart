import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The customer shell's currently-selected bottom-nav tab index.
/// Lives outside CustomerShell's own State so other screens (e.g. the
/// profile avatar tap target on Home) can switch tabs without needing
/// a reference to the shell widget itself.
final shellTabIndexProvider = StateProvider<int>((ref) => 0);

/// Tab indices, named — avoids magic numbers scattered across screens
/// that navigate to a specific tab.
abstract class ShellTab {
  static const home = 0;
  static const search = 1;
  static const orders = 2;
  static const favorites = 3;
  static const profile = 4;
}
