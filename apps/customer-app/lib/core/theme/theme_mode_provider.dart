import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// App-wide theme mode.
///
/// Defaults to LIGHT on purpose: only the redesigned Home + navigation shell
/// are on the theme-aware palette so far. Every other screen still uses the
/// legacy light-only `HatlyColors` constants and would be unreadable on a dark
/// background. Flip the default to [ThemeMode.system] once those screens are
/// migrated (tracked in the slice report). Design Review can flip it at
/// runtime through this provider.
final themeModeProvider = StateProvider<ThemeMode>((ref) => ThemeMode.light);
