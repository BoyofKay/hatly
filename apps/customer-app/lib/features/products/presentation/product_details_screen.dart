import '../../vendors/presentation/widgets/vendor_closed_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../shared_widgets/expandable_text.dart';
import '../../../shared_widgets/hatly_badge.dart';
import '../../../shared_widgets/hatly_cta_button.dart';
import '../../../shared_widgets/hatly_quantity_control.dart';
import '../../../shared_widgets/hatly_soft_image.dart';
import '../../../shared_widgets/ltr_text.dart';
import '../../auth/presentation/auth_gate.dart';
import '../../../shared_widgets/weight_selector.dart';
import '../../cart/data/cart_providers.dart';
import '../../cart/presentation/cart_error_messages.dart';
import '../../cart/presentation/cart_compatibility_flow.dart';
import 'widgets/weight_inline_input.dart';
import '../../cart/presentation/widgets/cart_mini_sheet.dart';
import '../../search/presentation/widgets/explore_message.dart';
import '../data/product_providers.dart';
import '../domain/product.dart';
import '../domain/product_configuration.dart';
import 'widgets/product_option_group.dart';

/// Product Details for ONE vendor listing (`GET /products/:id`) — image first, then name, price, the selling
/// store, description, the real option groups, quantity, total and a full-width "أضف للسلة" in the content
/// (not sticky). The id is the LISTING id: it is exactly what goes to `POST /cart/items`.
///
/// When the listing belongs to a marketplace (catalog) product, "تغيير المتجر" goes back to the store
/// selector; [fromCatalog] says the selector is already right below us on the stack, so it simply pops.
///
/// The customer's in-progress choices live in a pure [ProductConfiguration] held by this screen's own
/// state, so they are discarded with the screen — there is no global mutable state.
class ProductDetailsScreen extends ConsumerStatefulWidget {
  const ProductDetailsScreen(
      {super.key, required this.productId, this.fromCatalog = false});

  final String productId;
  final bool fromCatalog;

  @override
  ConsumerState<ProductDetailsScreen> createState() =>
      _ProductDetailsScreenState();
}

class _ProductDetailsScreenState extends ConsumerState<ProductDetailsScreen> {
  ProductConfiguration? _config;
  bool _isAdding = false;
  bool _showOptionErrors = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final productAsync = ref.watch(productDetailsProvider(widget.productId));

    return productAsync.when(
      loading: () => Scaffold(
        appBar: AppBar(),
        body: Center(
            child: CircularProgressIndicator(color: context.palette.accent)),
      ),
      error: (error, stackTrace) => Scaffold(
        appBar: AppBar(),
        body: ExploreMessage(
          icon: Icons.error_outline_rounded,
          title: l10n.somethingWentWrong,
          retryLabel: l10n.retry,
          onRetry: () =>
              ref.invalidate(productDetailsProvider(widget.productId)),
        ),
      ),
      data: (product) {
        _config ??= ProductConfiguration.initial(product);
        return _buildContent(context, product, _config!);
      },
    );
  }

  Widget _buildContent(
      BuildContext context, Product product, ProductConfiguration config) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name =
        isArabic && product.nameAr != null ? product.nameAr! : product.name;
    final description = isArabic && product.descriptionAr != null
        ? product.descriptionAr
        : product.description;
    final offer = product.activeOffer;
    final flashPrice = offer != null &&
            offer.isFlashSale &&
            offer.specialPriceMinor != null &&
            offer.specialPriceMinor! < product.priceMinor
        ? offer.specialPriceMinor
        : null;
    final unit = product.isWeighted ? ' /kg' : '';
    final total = config.estimatedTotalMinor(product);
    final vendor = product.vendor;
    final VoidCallback? openVendor = vendor == null || vendor.vendorBranchId.isEmpty
        ? null : () => context.push('/vendors/${vendor.vendorBranchId}');

    return Scaffold(
      body: SafeArea(
        top: false,
        child: ListView(
          padding: const EdgeInsets.only(bottom: HatlySpacing.xl),
          children: [
            // Reference board ("تفاصيل المنتج"): the photo fills the width on a soft panel with rounded lower corners, then the
            // name and price are centred under it.
            Stack(clipBehavior: Clip.none, children: [
              Padding(
                padding: EdgeInsets.only(bottom: vendor != null ? 28 : 0),
                child: ClipRRect(
                borderRadius: const BorderRadius.vertical(bottom: Radius.circular(HatlyRadius.promoBanner + 8)),
                child: AspectRatio(
                  aspectRatio: 1.9,
                  child: HatlySoftImage(url: product.imageUrl, width: double.infinity,
                    height: double.infinity, radius: 0, placeholderIcon: Icons.shopping_basket_outlined,
                    placeholderIconSize: 64, semanticLabel: name),
                ),
              )),
              PositionedDirectional(start: 12, top: 8,
                child: Material(color: const Color(0xAA000000), shape: const CircleBorder(),
                  child: IconButton(
                    tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                    icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
                    onPressed: () => Navigator.of(context).maybePop(),
                  ),
                ),
              ),
              if (vendor != null)
                PositionedDirectional(start: 18, bottom: 0,
                  child: Semantics(
                    key: const Key('product-vendor-link'),
                    button: true,
                    label: isArabic && vendor.nameAr != null ? vendor.nameAr! : vendor.name,
                    excludeSemantics: true,
                    onTap: openVendor,
                    child: Material(color: p.surface, shape: const CircleBorder(), elevation: 3,
                      child: InkWell(customBorder: const CircleBorder(),
                        onTap: openVendor,
                        child: Padding(padding: const EdgeInsets.all(4),
                          child: HatlySoftImage(url: vendor.logoUrl, width: 56, height: 56,
                            circular: true, placeholderIcon: Icons.storefront_outlined),
                        ),
                      ),
                    ),
                  ),
                ),
            ]),
            Padding(
              padding: const EdgeInsets.fromLTRB(HatlySpacing.screenPadding,
                  HatlySpacing.lg, HatlySpacing.screenPadding, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Semantics(
                    header: true,
                    child: Text(name,
                        textAlign: TextAlign.center,
                        style: context.type.h1.copyWith(
                            color: p.textPrimary, fontWeight: FontWeight.w800)),
                  ),
                  const SizedBox(height: HatlySpacing.sm),
                  Wrap(
                    alignment: WrapAlignment.center,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: HatlySpacing.sm,
                    runSpacing: HatlySpacing.xs,
                    children: [
                      LtrText(
                          '${formatMinorUnits(flashPrice ?? product.priceMinor, context)}$unit',
                          style: context.type.h1.copyWith(
                              color: flashPrice != null ? p.urgent : p.link,
                              fontWeight: FontWeight.w800)),
                      if (flashPrice != null)
                        LtrText(
                            '${formatMinorUnits(product.priceMinor, context)}$unit',
                            style: context.type.small.copyWith(
                                decoration: TextDecoration.lineThrough)),
                      if (offer != null)
                        HatlyBadge(
                          kind: offer.isFlashSale
                              ? HatlyBadgeKind.flashSale
                              : HatlyBadgeKind.offer,
                          label: offer.isFlashSale
                              ? l10n.badgeFlashSale
                              : l10n.subtotalDiscountAvailable,
                        ),
                      if (!product.isAvailable)
                        HatlyBadge(
                            kind: HatlyBadgeKind.unavailable,
                            label: l10n.productUnavailable),
                    ],
                  ),
                  if (product.vendor != null && product.catalogProductId != null)
                    Center(child: TextButton(
                      onPressed: () => _changeStore(product.catalogProductId!),
                      child: Text(l10n.catalogChangeStore),
                    )),
                  if (description != null && description.trim().isNotEmpty) ...[
                    const SizedBox(height: HatlySpacing.md),
                    ExpandableText(description,
                        moreLabel: l10n.descriptionReadMore,
                        lessLabel: l10n.descriptionReadLess),
                  ],
                  if (product.options.isNotEmpty) ...[
                    const SizedBox(height: HatlySpacing.lg),
                    Text(l10n.productOptionsTitle,
                        style: context.type.title.copyWith(
                            color: p.textPrimary, fontWeight: FontWeight.w800)),
                    const SizedBox(height: HatlySpacing.sm),
                    for (final option in product.options) ...[
                      ProductOptionGroup(
                        option: option,
                        selected: config.selectedFor(option),
                        showError: _showOptionErrors,
                        onToggle: (valueId) => setState(
                            () => _config = config.toggle(option, valueId)),
                      ),
                      const SizedBox(height: HatlySpacing.md),
                    ],
                  ],
                  if (product.isAvailable) ...[
                    const SizedBox(height: HatlySpacing.md),
                    _QuantityRow(
                        product: product,
                        config: config,
                        onChanged: (c) => setState(() => _config = c)),
                    const SizedBox(height: HatlySpacing.lg),
                    Row(
                      children: [
                        Expanded(
                          child: Text(l10n.productTotalLabel,
                              style: context.type.body
                                  .copyWith(color: p.textMuted)),
                        ),
                        LtrText(formatMinorUnits(total, context),
                            style: context.type.h2.copyWith(
                                color: p.textPrimary,
                                fontWeight: FontWeight.w800)),
                      ],
                    ),
                    const SizedBox(height: HatlySpacing.md),
                    HatlyCtaButton(
                      label: l10n.productAddToCart,
                      isLoading: _isAdding,
                      onPressed: product.vendor?.isOpen == false
                          ? null
                          : () => _addToCart(product),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _changeStore(String catalogProductId) {
    if (widget.fromCatalog && context.canPop()) {
      context.pop();
    } else {
      context.pushReplacement('/catalog-products/$catalogProductId');
    }
  }

  Future<void> _addToCart(Product product) async {
    // A guest browses products freely, but the cart needs an account: sign in (and come back here) first.
    if (!requireSignIn(context, ref)) return;
    // Owner request 2026-11-23: a closed store takes no order — say so here (Close / View menu) instead of letting the customer
    // fill a cart that checkout will refuse.
    final closedVendor = product.vendor;
    if (closedVendor != null && !closedVendor.isOpen) {
      final isArabic = Localizations.localeOf(context).languageCode == 'ar';
      final name = isArabic && closedVendor.nameAr != null
          ? closedVendor.nameAr!
          : closedVendor.name;
      final storePath = '/vendors/${product.vendorBranchId}';
      final router = GoRouter.of(context);
      final matches = router.routerDelegate.currentConfiguration.matches;
      final previous = matches.length >= 2
          ? matches[matches.length - 2].matchedLocation
          : null;
      await showVendorClosedDialog(context,
          vendorName: name,
          onViewMenu: product.vendorBranchId.isEmpty
              ? null
              : () {
                  if (previous == storePath && router.canPop()) {
                    router.pop();
                  } else {
                    router.pushReplacement(storePath);
                  }
                });
      return;
    }
    final config = _config!;
    // Mirrors the backend's OPTION_REQUIRED rule so the customer learns it in words before a round trip.
    if (!config.isValid(product)) {
      setState(() => _showOptionErrors = true);
      return;
    }
    setState(() => _isAdding = true);
    // Ask the server whether this product fits the current cart BEFORE adding it (and offer the way out when it does not).
    if (!await ensureCartCompatible(context, ref, product.id)) {
      if (mounted) setState(() => _isAdding = false);
      return;
    }
    if (!mounted) return;

    // Weighted vs piece split, exactly as before: never send the piece quantity as the weight, and never
    // invent a weight for a piece product.
    final error = await ref.read(cartControllerProvider.notifier).addItem(
          productId: product.id,
          quantity: product.isWeighted ? 1 : config.quantity,
          selectedOptionValueIds: config.selectedValueIds(),
          requestedWeightGrams:
              product.isWeighted ? config.requestedWeightGrams : null,
        );

    if (!mounted) return;
    setState(() => _isAdding = false);

    if (error != null) {
      // The backend is authoritative (vendor-group limit, pickup rule, unavailable product, …).
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(localizedCartErrorMessage(context, error))),
      );
      return;
    }

    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final vendor = product.vendor;
    final addedName =
        isArabic && product.nameAr != null ? product.nameAr! : product.name;
    // Owner decision 2026-11-22: after adding, the customer lands on the product's store page (whose cart bar shows the new total)
    // with a short note and a "View cart" shortcut — no extra sheet to dismiss. Only a product without a store keeps the sheet.
    if (product.vendorBranchId.isNotEmpty) {
      final l10n = AppLocalizations.of(context);
      final messenger = ScaffoldMessenger.of(context);
      final router = GoRouter.of(context);
      // Always land on THIS product's store page: back to it when the customer came from it, otherwise (opened from Home's
      // best sellers / offers, search, a link) the product page is replaced by the store page, so the system back gesture then
      // returns to wherever they started (e.g. Home).
      final storePath = '/vendors/${product.vendorBranchId}';
      final matches = router.routerDelegate.currentConfiguration.matches;
      final previous = matches.length >= 2
          ? matches[matches.length - 2].matchedLocation
          : null;
      if (previous == storePath && context.canPop()) {
        context.pop();
      } else {
        context.pushReplacement(storePath);
      }
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(
          key: const Key('added-to-cart-snackbar'),
          content: Text('${l10n.addedToCartConfirmation} · $addedName'),
          duration: const Duration(seconds: 3),
          behavior: SnackBarBehavior.floating,
          action: SnackBarAction(
              label: l10n.cartSummaryViewCart,
              onPressed: () => router.push('/cart')),
        ));
      return;
    }
    await showCartMiniSheet(
      context,
      item: AddedCartItem(
        name:
            isArabic && product.nameAr != null ? product.nameAr! : product.name,
        imageUrl: product.imageUrl,
        quantityLabel: product.isWeighted
            ? '${(config.requestedWeightGrams / 1000).toStringAsFixed(2)} kg'
            : '×${config.quantity}',
        vendorName: vendor == null
            ? null
            : (isArabic && vendor.nameAr != null
                ? vendor.nameAr!
                : vendor.name),
        totalMinor: config.estimatedTotalMinor(product),
      ),
      onViewCart: () {
        if (mounted) context.push('/cart');
      },
    );
  }
}

class _QuantityRow extends StatelessWidget {
  const _QuantityRow(
      {required this.product, required this.config, required this.onChanged});

  final Product product;
  final ProductConfiguration config;
  final ValueChanged<ProductConfiguration> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;

    final row = Row(
      children: [
        Expanded(
          child: Text(
              product.isWeighted
                  ? l10n.orderRequestedWeightLabel
                  : l10n.quantityLabel,
              style: context.type.title
                  .copyWith(color: p.textPrimary, fontWeight: FontWeight.w700)),
        ),
        if (product.isWeighted)
          // Weighted: 100g steps, the same floor and (tracked) stock guard as the cart's weight editor.
          HatlyQuantityControl(
            valueLabel: weightShortLabel(config.requestedWeightGrams, l10n),
            decreaseTooltip: l10n.quantityDecrease,
            increaseTooltip: l10n.quantityIncrease,
            valueTapTooltip: l10n.weightEntryTooltip,
            onValueTap: () async {
              final grams = await showWeightEntryDialog(context,
                  initialGrams: config.requestedWeightGrams,
                  maxGrams: config.maxWeightFor(product));
              if (grams != null) onChanged(config.withWeight(product, grams));
            },
            onDecrease: config.canDecreaseWeight
                ? () => onChanged(config.withWeight(
                    product, weightStepDown(config.requestedWeightGrams)))
                : null,
            onIncrease: config.canIncreaseWeight(product)
                ? () => onChanged(config.withWeight(
                    product, weightStepUp(config.requestedWeightGrams)))
                : null,
          )
        else
          HatlyQuantityControl(
            valueLabel: '${config.quantity}',
            decreaseTooltip: l10n.quantityDecrease,
            increaseTooltip: l10n.quantityIncrease,
            onDecrease: config.canDecreaseQuantity
                ? () =>
                    onChanged(config.copyWith(quantity: config.quantity - 1))
                : null,
            onIncrease: config.canIncreaseQuantity(product)
                ? () =>
                    onChanged(config.copyWith(quantity: config.quantity + 1))
                : null,
          ),
      ],
    );
    if (!product.isWeighted) return row;
    // Weighed products: the stepper moves in 100 g, so common amounts get one-tap presets (and the value can be typed).
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        row,
        const SizedBox(height: HatlySpacing.sm),
        WeightPresetChips(
          selectedGrams: config.requestedWeightGrams,
          maxGrams: config.maxWeightFor(product),
          onSelected: (grams) => onChanged(config.withWeight(product, grams)),
        ),
        const SizedBox(height: HatlySpacing.sm),
        WeightInlineInput(
          grams: config.requestedWeightGrams,
          minGrams: ProductConfiguration.minWeightGrams,
          maxGrams: config.maxWeightFor(product),
          onChanged: (grams) => onChanged(config.withWeight(product, grams)),
        ),
        const SizedBox(height: HatlySpacing.xs),
        Text(
          l10n.weightEstimateNote(
              formatMinorUnits(config.estimatedTotalMinor(product), context)),
          key: const Key('weight-estimate-note'),
          style: context.type.small.copyWith(color: p.textMuted),
        ),
      ],
    );
  }
}
