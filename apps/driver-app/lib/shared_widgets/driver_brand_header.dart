import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../features/deliveries/data/driver_providers.dart';
import '../core/localization/bilingual.dart';

/// Brand and Admin-managed identity remain visible across all four tabs and delivery detail routes.
/// This header is display-only: it cannot modify profile, dispatch, or shift data.
class DriverBrandHeader extends ConsumerWidget {
  const DriverBrandHeader({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final name = ref.watch(driverProfileNameProvider).valueOrNull;
    return Material(
      color: Colors.white,
      elevation: 1,
      child: Container(
        key: const Key('driver-global-brand-header'),
        height: 58,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Image.asset('assets/images/hatly-driver-logo.png', width: 42, height: 42, fit: BoxFit.contain),
          ),
          const SizedBox(width: 10),
          Expanded(child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(context.t('Hatly Driver', 'هاتلي للمندوب'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              if (name != null && name.trim().isNotEmpty)
                Text(name, key: const Key('driver-display-name'), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Color(0xFF666666))),
            ],
          )),
        ]),
      ),
    );
  }
}
