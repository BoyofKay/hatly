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
import '../../cart/data/cart_providers.dart';
import '../../cart/presentation/cart_error_messages.dart';
import '../../cart/presentation/widgets/cart_icon_button.dart';
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

    return Scaffold(
      appBar: AppBar(actions: const [CartIconButton()]),
      body: SafeArea(
        top: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(HatlySpacing.screenPadding,
              HatlySpacing.sm, HatlySpacing.screenPadding, HatlySpacing.xl),
          children: [
            AspectRatio(
              aspectRatio: 1.85,
              child: HatlySoftImage(
                url: product.imageUrl,
                width: double.infinity,
                height: double.infinity,
                placeholderIcon: Icons.shopping_basket_outlined,
                placeholderIconSize: 56,
                semanticLabel: name,
              ),
            ),
            const SizedBox(height: HatlySpacing.lg),
            Semantics(
              header: true,
              child: Text(name,
                  style: context.type.h1.copyWith(
                      color: p.textPrimary, fontWeight: FontWeight.w800)),
            ),
            const SizedBox(height: HatlySpacing.sm),
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: HatlySpacing.sm,
              runSpacing: HatlySpacing.xs,
              children: [
                LtrText(
                    '${formatMinorUnits(flashPrice ?? product.priceMinor, context)}$unit',
                    style: context.type.h2.copyWith(
                        color: flashPrice != null ? p.urgent : p.textPrimary,
                        fontWeight: FontWeight.w800)),
                if (flashPrice != null)
                  LtrText(
                      '${formatMinorUnits(product.priceMinor, context)}$unit',
                      style: context.type.small
                          .copyWith(decoration: TextDecoration.lineThrough)),
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
            if (product.vendor != null) ...[
              const SizedBox(height: HatlySpacing.md),
              _VendorSummary(
                vendor: product.vendor!,
                onChangeStore: product.catalogProductId == null
                    ? null
                    : () => _changeStore(product.catalogProductId!),
              ),
            ],
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
                  onToggle: (valueId) =>
                      setState(() => _config = config.toggle(option, valueId)),
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
                        style: context.type.body.copyWith(color: p.textMuted)),
                  ),
                  LtrText(formatMinorUnits(total, context),
                      style: context.type.h2.copyWith(
                          color: p.textPrimary, fontWeight: FontWeight.w800)),
                ],
              ),
              const SizedBox(height: HatlySpacing.md),
              HatlyCtaButton(
                label: l10n.productAddToCart,
                isLoading: _isAdding,
                onPressed: () => _addToCart(product),
              ),
            ],
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
    final config = _config!;
    // Mirrors the backend's OPTION_REQUIRED rule so the customer learns it in words before a round trip.
    if (!config.isValid(product)) {
      setState(() => _showOptionErrors = true);
      return;
    }
    setState(() => _isAdding = true);

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

class _VendorSummary extends StatelessWidget {
  const _VendorSummary({required this.vendor, required this.onChangeStore});

  final ProductVendorSummary vendor;
  final VoidCallback? onChangeStore;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name =
        isArabic && vendor.nameAr != null ? vendor.nameAr! : vendor.name;
    final hasRating = vendor.ratingCount > 0;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(HatlyRadius.card),
        boxShadow: HatlyShadows.soft(p),
      ),
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(
            HatlySpacing.ms, HatlySpacing.sm, HatlySpacing.sm, HatlySpacing.ms),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Name row: small logo, the name, and "تغيير المتجر" on the same line. The name gets the larger
            // share; at very large text sizes both shrink/ellipsize instead of overflowing.
            Row(
              children: [
                HatlySoftImage(
                  url: vendor.logoUrl,
                  width: 32,
                  height: 32,
                  circular: true,
                  placeholderIcon: Icons.storefront_outlined,
                  placeholderIconSize: 18,
                ),
                const SizedBox(width: HatlySpacing.sm),
                Expanded(
                  flex: 2,
                  child: Text(name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.type.body.copyWith(
                          color: p.textPrimary, fontWeight: FontWeight.w700)),
                ),
                if (onChangeStore != null)
                  Flexible(
                    child: Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: TextButton(
                        style: TextButton.styleFrom(
                          minimumSize: const Size(
                              HatlyTouch.minTarget, HatlyTouch.minTarget),
                          padding: const EdgeInsets.symmetric(
                              horizontal: HatlySpacing.sm),
                          foregroundColor: p.link,
                        ),
                        onPressed: onChangeStore,
                        child: Text(l10n.catalogChangeStore,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.type.small.copyWith(
                                color: p.link, fontWeight: FontWeight.w700)),
                      ),
                    ),
                  ),
              ],
            ),
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: HatlySpacing.sm,
              runSpacing: HatlySpacing.xs,
              children: [
                if (hasRating)
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.star_rounded, size: 16, color: p.warning),
                      const SizedBox(width: 2),
                      LtrText(vendor.ratingAverage.toStringAsFixed(1),
                          style: context.type.small.copyWith(
                              color: p.textPrimary,
                              fontWeight: FontWeight.w700)),
                      const SizedBox(width: 4),
                      LtrText('(${vendor.ratingCount})',
                          style: context.type.caption),
                    ],
                  ),
                HatlyBadge(
                  kind: vendor.isOpen
                      ? HatlyBadgeKind.open
                      : HatlyBadgeKind.closed,
                  label: vendor.isOpen ? l10n.vendorOpenNow : l10n.vendorClosed,
                ),
              ],
            ),
          ],
        ),
      ),
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

    return Row(
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
            valueLabel:
                '${(config.requestedWeightGrams / 1000).toStringAsFixed(2)} kg',
            decreaseTooltip: l10n.quantityDecrease,
            increaseTooltip: l10n.quantityIncrease,
            onDecrease: config.canDecreaseWeight
                ? () => onChanged(config.copyWith(
                    requestedWeightGrams: config.requestedWeightGrams -
                        ProductConfiguration.weightStepGrams))
                : null,
            onIncrease: config.canIncreaseWeight(product)
                ? () => onChanged(config.copyWith(
                    requestedWeightGrams: config.requestedWeightGrams +
                        ProductConfiguration.weightStepGrams))
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
  }
}
