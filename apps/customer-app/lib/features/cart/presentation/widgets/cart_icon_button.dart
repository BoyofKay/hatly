import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../data/cart_providers.dart';

class CartIconButton extends ConsumerWidget {
  const CartIconButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cartAsync = ref.watch(cartControllerProvider);
    final itemCount = cartAsync.valueOrNull?.itemCount ?? 0;
    final p = context.palette;

    return Stack(
      alignment: Alignment.center,
      children: [
        IconButton(
          // Polish pass: every other icon-only AppBar action in this app
          // (e.g. `_RoundIconButton`, favorite-heart buttons) has a tooltip;
          // this one — reused on nearly every screen's AppBar — didn't.
          tooltip: AppLocalizations.of(context).cart,
          icon: const Icon(Icons.shopping_bag_outlined),
          onPressed: () => context.push('/cart'),
        ),
        if (itemCount > 0)
          Positioned.directional(
            textDirection: Directionality.of(context),
            top: 6,
            // end (not right/left) so the badge sits on the correct
            // corner under RTL — the icon itself is symmetric, but the
            // badge's corner should still follow layout direction
            // rather than being visually fixed.
            end: 6,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              decoration: BoxDecoration(
                  color: HatlyColors.primaryOrange,
                  borderRadius: BorderRadius.circular(10)),
              constraints: const BoxConstraints(minWidth: 16),
              child: LtrText(
                '$itemCount',
                textAlign: TextAlign.center,
                // Polish pass: was hardcoded `Colors.white` on the brand-orange
                // fill — 2.6:1 contrast, fails accessibility (see
                // hatly_palette.dart's own documented rule). `p.accentOn` is
                // the correct dark ink (7:1) for new components.
                style: TextStyle(
                    color: p.accentOn,
                    fontSize: 10,
                    fontWeight: FontWeight.w700),
              ),
            ),
          ),
      ],
    );
  }
}
