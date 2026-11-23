import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The active Home promotion drives the header and pinned search tint.
final activeHeroColorProvider = StateProvider<Color>((ref) => const Color(0xFFFF7A1A));

/// Sector colors are admin-owned. The fallback palette is only for old sectors
/// that have not had a color configured; it never affects business rules.
Color colorForSector(String? slug, String? configuredHex) {
  if (configuredHex != null && RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(configuredHex)) {
    return Color(int.parse(configuredHex.substring(1), radix: 16) | 0xFF000000);
  }
  const colors = <Color>[
    Color(0xFFE98559), Color(0xFF72AB87), Color(0xFF719ED5),
    Color(0xFFD68DBD), Color(0xFF91B9BC), Color(0xFFDEAA66),
    Color(0xFF9791C9), Color(0xFF8EB36F),
  ];
  if (slug == null || slug.isEmpty) return const Color(0xFFFFA768);
  var hash = 0;
  for (final code in slug.codeUnits) { hash = (hash * 31 + code) & 0x7fffffff; }
  return colors[hash % colors.length];
}

Color translucentHero(Color source, Color surface) =>
    Color.alphaBlend(source.withValues(alpha: 0.60), surface);
