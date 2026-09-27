import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/presentation/session_controller.dart';
import '../../features/auth/presentation/screens/splash_screen.dart';
import '../../features/auth/presentation/screens/phone_entry_screen.dart';
import '../../features/auth/presentation/screens/otp_verify_screen.dart';
import '../../features/shell/presentation/customer_shell.dart';
import '../../features/search/presentation/search_screen.dart';
import '../../features/vendors/presentation/vendor_list_screen.dart';
import '../../features/vendors/presentation/vendor_details_screen.dart';
import '../../features/products/presentation/product_details_screen.dart';
import '../../features/catalog/presentation/category_products_screen.dart';
import '../../features/catalog/presentation/catalog_product_details_screen.dart';
import '../../features/cart/presentation/cart_screen.dart';
import '../../features/orders/presentation/order_details_screen.dart';
import '../../features/orders/presentation/order_tracking_screen.dart';
import '../../features/checkout/presentation/order_success_screen.dart';
import '../../features/checkout/presentation/checkout_screen.dart';
import '../../features/checkout/presentation/transfer_instructions_screen.dart';
import '../../features/addresses/presentation/address_selection_screen.dart';
import '../../features/addresses/presentation/add_address_screen.dart';
import '../../features/addresses/domain/saved_address.dart';

/// Route table for the customer app.
///
/// Redirect logic is entirely driven by [SessionStatus]:
///  - `checking`        -> splash (shown regardless of target route)
///  - `unauthenticated` -> phone entry (otp screen is reachable as a
///                         sub-step of that flow, not independently)
///  - `authenticated`   -> the shell (or any pushed route on top of it —
///                         /search, /vendors, /vendors/:id, /products/:id
///                         all require an authenticated session same as
///                         the shell)
///
/// This is the ONLY place auth-based routing decisions are made —
/// individual screens never redirect themselves.
final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: _SessionListenable(ref),
    redirect: (context, state) {
      final status = ref.read(sessionControllerProvider).status;
      final path = state.matchedLocation;

      if (status == SessionStatus.checking) {
        return path == '/splash' ? null : '/splash';
      }

      if (status == SessionStatus.unauthenticated) {
        final onAuthFlow = path == '/phone' || path == '/otp';
        return onAuthFlow ? null : '/phone';
      }

      // authenticated
      final onAuthFlow =
          path == '/splash' || path == '/phone' || path == '/otp';
      return onAuthFlow ? '/' : null;
    },
    routes: [
      GoRoute(
          path: '/splash', builder: (context, state) => const SplashScreen()),
      GoRoute(
          path: '/phone',
          builder: (context, state) => const PhoneEntryScreen()),
      GoRoute(
          path: '/otp', builder: (context, state) => const OtpVerifyScreen()),
      GoRoute(path: '/', builder: (context, state) => const CustomerShell()),
      GoRoute(
          path: '/search', builder: (context, state) => const SearchScreen()),
      GoRoute(path: '/cart', builder: (context, state) => const CartScreen()),
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
      // Category tap (Home / Explore) → product-first listing of the sector.
      GoRoute(
        path: '/category-products',
        builder: (context, state) => CategoryProductsScreen(
          sectorId: state.uri.queryParameters['sectorId'] ?? '',
          sectorName: state.uri.queryParameters['sectorName'],
        ),
      ),
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
          final extra =
              state.extra as ({int? totalMinor, String paymentMethodLabel})?;
          return TransferInstructionsScreen(
            orderId: orderId,
            totalMinor: extra?.totalMinor,
            paymentMethodLabel: extra?.paymentMethodLabel ?? '',
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
