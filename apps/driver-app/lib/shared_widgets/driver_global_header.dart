import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/localization/bilingual.dart';
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
    return Container(
      key: const Key('driver-pinned-header'),
      padding: const EdgeInsetsDirectional.fromSTEB(14, 7, 14, 7),
      decoration: const BoxDecoration(color: Colors.white, border:
          Border(bottom: BorderSide(color: Color(0xFFEAEAEA)))),
      child: Row(children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(9),
          child: Image.asset(
            'assets/images/hatly-logo.jpg',
            key: const Key('hatly-driver-logo'),
            width: 38,
            height: 38,
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) => const Icon(Icons.local_shipping, size: 36),
          ),
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(context.t('Hatly Driver', 'مندوب هاتلي'),
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
              if (name?.trim().isNotEmpty == true)
                Text(name!, key: const Key('driver-header-name'),
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B))),
            ],
          ),
        ),
      ]),
    );
  }
}
