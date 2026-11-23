import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../features/auth/presentation/auth_state_provider.dart';
import '../features/overview/overview_api.dart';

/// Global, pinned driver-app brand. Also shows the name managed by Admin,
/// on Orders, History, Earnings, Profile and pushed detail pages.
class DriverGlobalHeader extends ConsumerWidget {
  const DriverGlobalHeader({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authenticated = ref.watch(authStateProvider).isAuthenticated;
    final name = authenticated ? ref.watch(driverProfileNameProvider).valueOrNull : null;
    final trimmed = name?.trim() ?? '';
    final initial = trimmed.isEmpty ? null : trimmed.characters.first.toUpperCase();
    return Container(
      key: const Key('driver-pinned-header'),
      padding: const EdgeInsetsDirectional.fromSTEB(14, 4, 14, 4),
      decoration: const BoxDecoration(color: Colors.white),
      child: Row(children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(15),
          child: Image.asset(
            'assets/images/hatly-driver-icon.png',
            key: const Key('hatly-driver-logo'),
            width: 52,
            height: 52,
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) => const Icon(Icons.local_shipping, size: 36),
          ),
        ),
        const Spacer(),
        if (initial != null)
          Semantics(
            label: trimmed,
            child: CircleAvatar(
              key: const Key('driver-header-initial'),
              radius: 20,
              backgroundColor: const Color(0xFFFFE2CD),
              child: Text(initial, style: const TextStyle(color: Color(0xFF9F4700), fontWeight: FontWeight.w800, fontSize: 17)),
            ),
          ),
      ]),
    );
  }
}
