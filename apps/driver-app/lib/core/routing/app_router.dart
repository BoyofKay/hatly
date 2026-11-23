import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/presentation/auth_state_provider.dart';
import '../../features/auth/presentation/forced_password_change_screen.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/earnings/presentation/earnings_screen.dart';
import '../../features/history/presentation/history_screen.dart';
import '../../features/home/presentation/home_screen.dart';
import '../../features/profile/presentation/profile_screen.dart';
import '../../features/shell/driver_shell.dart';
import '../../features/deliveries/presentation/delivery_detail_screen.dart';

final appRouterProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authStateProvider);

  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      final loggingIn = state.matchedLocation == '/login';
      final changing = state.matchedLocation == '/change-password';
      if (!authState.isAuthenticated && !loggingIn) return '/login';
      // A temporary password set by Hatly: nothing but "choose a new password" until it is changed.
      if (authState.isAuthenticated && authState.mustChangePassword) return changing ? null : '/change-password';
      if (authState.isAuthenticated && (loggingIn || changing)) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(path: '/change-password', builder: (context, state) => const ForcedPasswordChangeScreen()),
      // Orders / History / Earnings / Profile share one navigation bar.
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => DriverShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/', builder: (context, state) => const HomeScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/history', builder: (context, state) => const HistoryScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/earnings', builder: (context, state) => const EarningsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/profile', builder: (context, state) => const ProfileScreen())]),
        ],
      ),
      GoRoute(
        path: '/deliveries/:id',
        builder: (context, state) {
          final id = state.pathParameters['id']!;
          return DeliveryDetailScreen(deliveryId: id);
        },
      ),
    ],
  );
});
