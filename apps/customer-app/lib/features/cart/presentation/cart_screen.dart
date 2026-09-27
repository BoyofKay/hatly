import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_cta_button.dart';
import '../../search/presentation/widgets/explore_message.dart';
import '../../shell/presentation/shell_tab_provider.dart';
import '../data/cart_providers.dart';
import '../domain/cart.dart';
import 'cart_error_messages.dart';
import 'widgets/cart_item_row.dart';
import 'widgets/cart_states.dart';
import 'widgets/cart_vendor_section.dart';

/// The real, groups-based cart (`cartControllerProvider` is the single Cart source): one collapsible section
/// per `CartGroup`, never flattened, because an item's vendor and subtotal only make sense per group.
///
/// Every number shown is a field the API returned (line totals, vendor subtotals). There is deliberately NO
/// grand total, delivery, discount total or wallet here: the backend has no authoritative total for them yet.
///
/// Expanded/collapsed vendor sections and the "line is updating" markers are local to this screen — nothing is
/// persisted. All mutations go through the existing controller; the backend response decides the resulting
/// groups (e.g. a vendor group disappears when its last item is removed).
class CartScreen extends ConsumerStatefulWidget {
  const CartScreen({super.key});

  @override
  ConsumerState<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends ConsumerState<CartScreen> {
  /// User's explicit expand/collapse choices by group id. Without an entry a group is expanded only if it
  /// is the first one.
  final Map<String, bool> _expanded = {};
  final Set<String> _busy = {};

  bool _isExpanded(CartGroup group, int index) =>
      _expanded[group.id] ?? index == 0;

  Future<void> _mutate(
      String itemId, Future<ApiException?> Function() call) async {
    if (_busy.contains(itemId)) {
      return; // no duplicate taps while one is running
    }
    setState(() => _busy.add(itemId));
    final error = await call();
    if (!mounted) return;
    setState(() => _busy.remove(itemId));
    if (error != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(localizedCartErrorMessage(context, error))),
      );
    }
  }

  void _explore() {
    // Existing navigation: the shell's Explore tab. /cart is pushed above the shell, so returning to '/'
    // shows it.
    ref.read(shellTabIndexProvider.notifier).state = ShellTab.search;
    context.go('/');
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final cartAsync = ref.watch(cartControllerProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.cart)),
      body: cartAsync.when(
        loading: () => const CartSkeleton(),
        error: (error, stackTrace) => ExploreMessage(
          icon: Icons.error_outline_rounded,
          title: l10n.somethingWentWrong,
          retryLabel: l10n.retry,
          onRetry: () => ref.read(cartControllerProvider.notifier).refresh(),
        ),
        data: (cart) {
          if (cart.isEmpty) return CartEmptyView(onExplore: _explore);
          return _buildCart(context, cart);
        },
      ),
    );
  }

  Widget _buildCart(BuildContext context, Cart cart) {
    final l10n = AppLocalizations.of(context);
    final controller = ref.read(cartControllerProvider.notifier);
    final hasEditable = cart.groups.any((g) => g.items.any((i) => !i.isAdHoc));

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(HatlySpacing.screenPadding),
            children: [
              for (var g = 0; g < cart.groups.length; g++) ...[
                if (g > 0) const SizedBox(height: HatlySpacing.md),
                CartVendorSection(
                  key: ValueKey(cart.groups[g].id),
                  group: cart.groups[g],
                  expanded: _isExpanded(cart.groups[g], g),
                  onToggle: () => setState(() => _expanded[cart.groups[g].id] =
                      !_isExpanded(cart.groups[g], g)),
                  children: [
                    for (final item in cart.groups[g].items)
                      CartItemRow(
                        key: ValueKey(item.id),
                        item: item,
                        busy: _busy.contains(item.id),
                        isCustomRequest:
                            item.isAdHoc && !cart.groups[g].isAdHocService,
                        // "Edit" = open the product again (the backend cannot change options in place).
                        onEdit: item.productId == null
                            ? null
                            : () => context.push('/products/${item.productId}'),
                        onQuantityChanged: (q) => _mutate(
                            item.id,
                            () => controller.updateItemQuantity(
                                itemId: item.id, quantity: q)),
                        onWeightChanged: (grams) => _mutate(
                            item.id,
                            () => controller.updateItemWeight(
                                itemId: item.id, requestedWeightGrams: grams)),
                        onRemove: () => _mutate(
                            item.id, () => controller.removeItem(item.id)),
                      ),
                  ],
                ),
              ],
              if (hasEditable) ...[
                const SizedBox(height: HatlySpacing.md),
                Text(l10n.cartEditHint,
                    style: context.type.caption, textAlign: TextAlign.start),
              ],
            ],
          ),
        ),
        _CheckoutEntry(cart: cart),
      ],
    );
  }
}

/// The existing way into checkout (`/checkout`), unchanged in behaviour: enabled only when the backend says
/// `readyForCheckout`. It shows no amount — the cart has no authoritative total yet.
class _CheckoutEntry extends StatelessWidget {
  const _CheckoutEntry({required this.cart});

  final Cart cart;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: p.surface,
        boxShadow: HatlyShadows.floating(p),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(HatlySpacing.screenPadding),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (!cart.readyForCheckout)
                Padding(
                  padding: const EdgeInsets.only(bottom: HatlySpacing.sm),
                  child: Text(l10n.cartNotReadyForCheckout,
                      style: context.type.small.copyWith(color: p.warning)),
                ),
              HatlyCtaButton(
                label: l10n.cartContinueToCheckout,
                onPressed: cart.readyForCheckout
                    ? () => context.push('/checkout')
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
