import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';

/// Promotional entry for the independent, non-vendor Hatly Service workflow.
/// Only visual styling and copy change; the original /hatly-service route stays intact.
class HatlyServiceEntryCard extends StatelessWidget {
  const HatlyServiceEntryCard({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: HatlySpacing.screenPadding),
      child: Semantics(
        button: true,
        label: '${l10n.hatlyServiceEntryTitle}. ${l10n.hatlyServiceEntrySubtitle}',
        excludeSemantics: true,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            key: const Key('home-hatly-service-entry'),
            borderRadius: BorderRadius.circular(24),
            onTap: () => context.push('/hatly-service'),
            child: Ink(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(24),
                gradient: LinearGradient(
                  begin: AlignmentDirectional.topStart,
                  end: AlignmentDirectional.bottomEnd,
                  colors: [p.accent, p.accent.withValues(alpha: .85)],
                ),
                boxShadow: [BoxShadow(color: p.accent.withValues(alpha: .18), blurRadius: 16, offset: const Offset(0, 7))],
              ),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(color: Colors.white.withValues(alpha: .18), borderRadius: BorderRadius.circular(14)),
                        child: const Icon(Icons.storefront_outlined, size: 26, color: Colors.white),
                      ),
                      const Spacer(),
                      Icon(Icons.auto_awesome_rounded, color: Colors.white.withValues(alpha: .75), size: 24),
                    ]),
                    const SizedBox(height: 14),
                    Text(l10n.hatlyServiceEntryTitle, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 20, height: 1.25)),
                    const SizedBox(height: 9),
                    Text(l10n.hatlyServiceEntrySubtitle, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500, height: 1.5, fontSize: 13.5)),
                    const SizedBox(height: 17),
                    Row(children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(30)),
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          Text(ar ? 'اطلب من أي مكان' : 'Request from any place', style: TextStyle(color: p.accent, fontWeight: FontWeight.w800, fontSize: 12)),
                          const SizedBox(width: 5),
                          Icon(ar ? Icons.arrow_back_rounded : Icons.arrow_forward_rounded, size: 17, color: p.accent),
                        ]),
                      ),
                      const Spacer(),
                      const Icon(Icons.delivery_dining_rounded, color: Colors.white, size: 30),
                    ]),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
