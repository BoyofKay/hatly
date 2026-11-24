import '../../features/auth/presentation/screens/forced_password_change_screen.dart';
import 'package:flutter/material.dart';
import '../../features/favorites/presentation/favorites_screen.dart';
import '../../features/auth/presentation/auth_gate.dart' as gate;
import '../localization/l10n/app_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../shared_widgets/hatly_state_view.dart';
import '../localization/l10n/app_localizations.dart';
import '../../features/auth/presentation/auth_gate.dart';
import '../../features/auth/presentation/session_controller.dart';
import '../../features/auth/presentation/screens/splash_screen.dart';
import '../../features/auth/presentation/screens/phone_entry_screen.dart';
import '../../features/auth/presentation/screens/otp_verify_screen.dart';
import '../../features/shell/presentation/customer_shell.dart';
import '../../features/home/presentation/home_section_products_screen.dart';
import '../../features/home/presentation/widgets/home_promo_actions.dart';
import '../../features/search/presentation/search_screen.dart';
import '../../features/vendors/presentation/vendor_list_screen.dart';
import '../../features/vendors/presentation/vendor_details_screen.dart';
import '../../features/products/presentation/product_details_screen.dart';
import '../../features/catalog/presentation/catalog_product_details_screen.dart';
import '../../features/cart/presentation/cart_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import '../../features/orders/presentation/order_details_screen.dart';
import '../../features/orders/presentation/order_tracking_screen.dart';
import '../../features/checkout/presentation/order_success_screen.dart';
import '../../features/checkout/presentation/checkout_screen.dart';
import '../../features/checkout/presentation/transfer_instructions_screen.dart';
import '../../features/addresses/presentation/address_selection_screen.dart';
import '../../features/addresses/presentation/add_address_screen.dart';
import '../../features/addresses/presentation/my_addresses_screen.dart';
import '../../features/addresses/domain/saved_address.dart';
import '../../features/hatly_service/presentation/hatly_service_screen.dart';
import '../../features/profile/presentation/settings_screen.dart';
import '../../features/wallet/presentation/wallet_screen.dart';
import '../../features/loyalty/presentation/loyalty_screen.dart';

/// Route table for the customer app.
///
/// Redirect logic is entirely driven by [SessionStatus] (there is no second guest/auth mechanism):
///  - `checking`        -> splash (the requested location is carried in `?from=` so a deep link survives the restore)
///  - `unauthenticated` -> a GUEST. Public catalog routes (`isPublicGuestPath`: home shell, search, vendors, products) open
///                         normally and create nothing. Every other route is protected: the guest is sent to
///                         `/phone?from=<requested route>` and returns there after signing in or registering.
///                         (`/otp` is a sub-step of `/phone`.)
///  - `authenticated`   -> the app; the auth screens and splash send the customer to `from` (or home).
///
/// This is the ONLY place route access is decided — individual screens never redirect themselves. (Actions on a public
/// screen that need an account use `requireSignIn`, which only *opens* `/phone?from=...`.)
/// Shown alone after signing in with a temporary password.
const kChangePasswordPath = '/change-password';

final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: _SessionListenable(ref),
    redirect: (context, state) {
      final status = ref.read(sessionControllerProvider).status;
      final path = state.matchedLocation;
      final target = state.uri.toString();
      final from = safeReturnPath(state.uri.queryParameters['from']);
      final onAuthScreen = path == kSignInPath || path == kOtpPath;

      if (status == SessionStatus.checking) {
        if (path == kSplashPath) return null;
        return target == '/'
            ? kSplashPath
            : '$kSplashPath?from=${Uri.encodeQueryComponent(target)}';
      }

      if (status == SessionStatus.unauthenticated) {
        // A guest lands where they were headed (or on Home).
        if (path == kSplashPath) {
          return from ?? '/';
        }
        if (onAuthScreen || isPublicGuestPath(path)) return null;
        return signInLocation(returnTo: target);
      }

      // authenticated
      // A temporary password set by Hatly: nothing but "choose a new password" until it is changed (owner decision 2026-11-23).
      final mustChange = ref.read(sessionControllerProvider).mustChangePassword;
      if (mustChange) {
        return path == kChangePasswordPath ? null : kChangePasswordPath;
      }
      if (path == kChangePasswordPath) return '/';
      if (path == kSplashPath || onAuthScreen) return from ?? '/';
      return null;
    },
    // Polish pass: go_router's own default error page is unstyled and
    // English-only. A deep link (e.g. from a push notification) can carry
    // a server-supplied route that no longer matches any route here, so
    // this needs to be a real, on-brand, localized fallback rather than
    // relying on go_router's default.
    errorBuilder: (context, state) => Scaffold(
      appBar: AppBar(),
      body: HatlyStateView(
        icon: Icons.error_outline,
        title: AppLocalizations.of(context).routeNotFoundTitle,
        retryLabel: AppLocalizations.of(context).checkoutSuccessBackHome,
        onRetry: () => context.go('/'),
      ),
    ),
    routes: [
      GoRoute(
          path: '/splash', builder: (context, state) => const SplashScreen()),
      GoRoute(
          path: '/phone',
          builder: (context, state) => PhoneEntryScreen(
              returnTo: safeReturnPath(state.uri.queryParameters['from']))),
      GoRoute(
          path: '/otp', builder: (context, state) => const OtpVerifyScreen()),
      GoRoute(
          path: kChangePasswordPath,
          builder: (context, state) => const ForcedPasswordChangeScreen()),
      GoRoute(path: '/', builder: (context, state) => const CustomerShell()),
      GoRoute(path: '/favorites', builder: (context, state) => const FavoritesRouteView()),
      GoRoute(
          path: '/search', builder: (context, state) => const SearchScreen()),
      // "See all" behind a Home section (most-ordered | new | offers) — public, like the catalog it lists.
      GoRoute(
        path: '/home/products/:kind',
        builder: (context, state) {
          final kind = homeSectionKindFromSlug(state.pathParameters['kind']);
          return kind == null
              ? const HomeSectionUnknown()
              : HomeSectionProductsScreen(kind: kind);
        },
      ),
      GoRoute(path: '/cart', builder: (context, state) => const CartScreen()),
      // Standalone Hatly Service — NOT attached to any vendor catalog
      // (see hatly_service_screen.dart's own doc comment for how this
      // differs from the Vendor/Pharmacy Custom Request, which has no
      // route of its own — it is a bottom sheet reached from a vendor
      // branch screen instead).
      GoRoute(
        path: '/hatly-service',
        builder: (context, state) => HatlyServiceScreen(
          buyFromPlaceOnly: state.uri.queryParameters['entry'] == 'sector',
        ),
      ),
      GoRoute(
        path: '/vendors',
        builder: (context, state) {
          final sectorId = state.uri.queryParameters['sectorId'];
          final sectorName = state.uri.queryParameters['sectorName'];
          return VendorListScreen(category: sectorId, categoryName: sectorName);
        },
      ),
      GoRoute(
        path: '/vendors/:id',
        builder: (context, state) {
          final vendorId = state.pathParameters['id']!;
          return VendorDetailsScreen(vendorId: vendorId);
        },
      ),
      // Category tap (Home / Explore / search) is vendor-first — see `categoryListingRoute()` — and
      // resolves to `/vendors` above, not a dedicated category route. No product-first category
      // entry point exists anywhere in this router, deliberately (universal marketplace rule).
      // A marketplace (catalog) product and the stores that sell it.
      GoRoute(
        path: '/catalog-products/:id',
        builder: (context, state) => CatalogProductDetailsScreen(
            catalogProductId: state.pathParameters['id']!),
      ),
      // ONE vendor listing; the id is the listing id the cart uses. `from=catalog` = the store selector is
      // right below on the stack ("تغيير المتجر" pops back to it).
      GoRoute(
        path: '/products/:id',
        builder: (context, state) {
          final productId = state.pathParameters['id']!;
          return ProductDetailsScreen(
            productId: productId,
            fromCatalog: state.uri.queryParameters['from'] == 'catalog',
          );
        },
      ),
      GoRoute(
        path: '/notifications',
        builder: (context, state) => const NotificationsScreen(),
      ),
      GoRoute(
        path: '/orders/:id',
        builder: (context, state) {
          final orderId = state.pathParameters['id']!;
          return OrderDetailsScreen(orderId: orderId);
        },
      ),
      GoRoute(
        path: '/orders/:id/tracking',
        builder: (context, state) =>
            OrderTrackingScreen(orderId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/checkout/success/:orderId',
        builder: (context, state) =>
            OrderSuccessScreen(orderId: state.pathParameters['orderId']!),
      ),
      GoRoute(
        path: '/checkout',
        builder: (context, state) => const CheckoutScreen(),
      ),
      GoRoute(
        path: '/checkout/address',
        builder: (context, state) => const AddressSelectionScreen(),
      ),
      // Profile — My Addresses. A separate screen/route from
      // `/checkout/address` (Checkout's own select-and-pop flow) —
      // see MyAddressesScreen's own doc comment for why.
      GoRoute(
        path: '/profile/addresses',
        builder: (context, state) => const MyAddressesScreen(),
      ),
      // Profile — Wallet.
      GoRoute(
        path: '/profile/wallet',
        builder: (context, state) => const WalletScreen(),
      ),
      // Profile — Loyalty (consolidated customer-commerce milestone, Parts C/D).
      GoRoute(
        path: '/profile/loyalty',
        builder: (context, state) => const LoyaltyScreen(),
      ),
      GoRoute(
        path: '/profile/settings',
        builder: (context, state) => const SettingsScreen(),
      ),
      GoRoute(
        path: '/addresses/add',
        // Saved Address Edit: when a SavedAddress is passed as
        // `extra` (from AddressSelectionScreen's edit action), the
        // screen opens in edit mode; otherwise unchanged create-mode
        // behavior.
        builder: (context, state) =>
            AddAddressScreen(existing: state.extra as SavedAddress?),
      ),
      GoRoute(
        path: '/checkout/transfer/:orderId',
        builder: (context, state) {
          final orderId = state.pathParameters['orderId']!;
          final extra = state.extra as ({
            int? totalMinor,
            String paymentMethodLabel,
            String? orderNumber
          })?;
          return TransferInstructionsScreen(
            orderId: orderId,
            totalMinor: extra?.totalMinor,
            paymentMethodLabel: extra?.paymentMethodLabel ?? '',
            orderNumber: extra?.orderNumber,
          );
        },
      ),
    ],
  );
});

/// Bridges Riverpod state changes into something GoRouter's
/// `refreshListenable` (a plain ChangeNotifier) understands, so a
/// SessionStatus change re-runs `redirect` immediately instead of only
/// on the next navigation event.
class _SessionListenable extends ChangeNotifier {
  _SessionListenable(Ref ref) {
    ref.listen(sessionControllerProvider, (previous, next) {
      if (previous?.status != next.status) {
        notifyListeners();
      }
    });
  }
}

class FavoritesRouteView extends ConsumerWidget {
  const FavoritesRouteView({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    appBar: AppBar(title: Text(AppLocalizations.of(context).homeFavoritesShortcut)),
    body: ref.watch(gate.isSignedInProvider) ? const FavoritesScreen() : const gate.SignInRequiredView(),
  );
}
