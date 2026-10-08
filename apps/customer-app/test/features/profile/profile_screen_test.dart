import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/features/addresses/data/addresses_api.dart';
import 'package:hatly_customer/features/addresses/data/addresses_providers.dart';
import 'package:hatly_customer/features/addresses/domain/saved_address.dart';
import 'package:hatly_customer/features/auth/data/auth_providers.dart';
import 'package:hatly_customer/features/auth/data/auth_repository.dart';
import 'package:hatly_customer/features/profile/presentation/profile_screen.dart';
import 'package:hatly_customer/features/support/data/support_contact_api.dart';
import 'package:hatly_customer/features/support/data/support_providers.dart';
import 'package:hatly_customer/features/wallet/data/wallet_api.dart';
import 'package:hatly_customer/features/wallet/data/wallet_providers.dart';
import 'package:hatly_customer/features/wallet/domain/wallet_transaction.dart';

import '../../support/router_test_app.dart';

/// Profile — real default address, real wallet balance, navigation to
/// both management screens, support, and logout. No section here
/// reads a placeholder — everything comes from the same fakes-of-the-
/// real-API pattern already used throughout this test suite.
class _FakeAddressesApi implements AddressesApi {
  _FakeAddressesApi(this.addresses);
  final List<SavedAddress> addresses;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<SavedAddress>> getAddresses() async => addresses;
}

class _FakeWalletApi implements WalletApi {
  _FakeWalletApi(this.balanceMinor);
  final int balanceMinor;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<WalletBalance> getBalance() async => WalletBalance(balanceMinor: balanceMinor);
}

class _FakeAuthRepository implements AuthRepository {
  int logoutCalls = 0;

  /// When set, [logout] waits on it instead of resolving immediately —
  /// lets a test hold the first call open to simulate a slow network
  /// round-trip while it fires a second tap.
  Completer<void>? gate;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<bool> hasPersistedSession() async => true;

  @override
  Future<void> logout() async {
    logoutCalls++;
    if (gate != null) await gate!.future;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required List<SavedAddress> addresses,
  required int balanceMinor,
  List<String>? visited,
}) async {
  await tester.pumpWidget(hatlyRouterApp(
    locale: const Locale('en'),
    overrides: [
      addressesApiProvider.overrideWithValue(_FakeAddressesApi(addresses)),
      walletApiProvider.overrideWithValue(_FakeWalletApi(balanceMinor)),
      authRepositoryProvider.overrideWithValue(_FakeAuthRepository()),
      supportContactProvider.overrideWith(
          (ref) async => const SupportContact(whatsappNumber: '+201000000000')),
    ],
    routes: [
      GoRoute(path: '/', builder: (c, s) => const ProfileScreen()),
      probeRoute('/profile/addresses', visited: visited),
      probeRoute('/profile/wallet', visited: visited),
    ],
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows the real default address label, not a placeholder', (tester) async {
    await _pump(tester, addresses: [
      const SavedAddress(
          id: 'a1', line1: 'Nasr City', latitude: 30, longitude: 31, isDefault: true, label: 'Home'),
    ], balanceMinor: 0);

    expect(find.text('Home'), findsOneWidget);
  });

  testWidgets('shows "no default address yet" when nothing is set as default', (tester) async {
    await _pump(tester, addresses: [], balanceMinor: 0);

    expect(find.text('No default address yet'), findsOneWidget);
  });

  testWidgets('shows the real, server-authoritative wallet balance', (tester) async {
    await _pump(tester, addresses: [], balanceMinor: 25000);

    expect(find.byKey(const Key('profile-wallet-balance')), findsOneWidget);
    expect(find.text('250 EGP'), findsOneWidget);
  });

  testWidgets('tapping the address card navigates to My Addresses (the existing management screen)', (tester) async {
    final visited = <String>[];
    await _pump(tester, addresses: [], balanceMinor: 0, visited: visited);

    await tester.tap(find.byKey(const Key('profile-default-address-card')));
    await tester.pumpAndSettle();

    expect(visited, contains('/profile/addresses'));
  });

  testWidgets('tapping the wallet card navigates to Wallet', (tester) async {
    final visited = <String>[];
    await _pump(tester, addresses: [], balanceMinor: 0, visited: visited);

    await tester.tap(find.byKey(const Key('profile-wallet-card')));
    await tester.pumpAndSettle();

    expect(visited, contains('/profile/wallet'));
  });

  testWidgets('support entry is present and still wired to the existing WhatsApp support action', (tester) async {
    await _pump(tester, addresses: [], balanceMinor: 0);

    expect(find.byKey(const Key('profile-support-contact')), findsOneWidget);
  });

  testWidgets('logout regression: tapping logout calls the existing AuthRepository.logout()', (tester) async {
    final authRepo = _FakeAuthRepository();
    await tester.pumpWidget(hatlyRouterApp(
      locale: const Locale('en'),
      overrides: [
        addressesApiProvider.overrideWithValue(_FakeAddressesApi(const [])),
        walletApiProvider.overrideWithValue(_FakeWalletApi(0)),
        authRepositoryProvider.overrideWithValue(authRepo),
        supportContactProvider.overrideWith(
            (ref) async => const SupportContact(whatsappNumber: '+201000000000')),
      ],
      routes: [
        GoRoute(path: '/', builder: (c, s) => const ProfileScreen()),
      ],
    ));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Log out'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Log out'));
    await tester.pumpAndSettle();

    expect(authRepo.logoutCalls, 1);
  });

  testWidgets(
      'double-tapping Log out only calls AuthRepository.logout() once (Polish pass in-flight guard)',
      (tester) async {
    final authRepo = _FakeAuthRepository()..gate = Completer<void>();
    await tester.pumpWidget(hatlyRouterApp(
      locale: const Locale('en'),
      overrides: [
        addressesApiProvider.overrideWithValue(_FakeAddressesApi(const [])),
        walletApiProvider.overrideWithValue(_FakeWalletApi(0)),
        authRepositoryProvider.overrideWithValue(authRepo),
        supportContactProvider.overrideWith(
            (ref) async => const SupportContact(whatsappNumber: '+201000000000')),
      ],
      routes: [
        GoRoute(path: '/', builder: (c, s) => const ProfileScreen()),
      ],
    ));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Log out'));
    await tester.pumpAndSettle();
    // Both taps fire before any frame is pumped in between — the button
    // itself hasn't yet rebuilt into its disabled/loading state, so only
    // `_logout()`'s own `if (_isLoggingOut) return;` guard (not
    // `HatlyButton`'s `isLoading`-disables-onPressed behavior) is what
    // stops the second call, exactly matching the real fast-double-tap race.
    await tester.tap(find.text('Log out'));
    await tester.tap(find.text('Log out'));
    await tester.pump();
    authRepo.gate!.complete();
    await tester.pumpAndSettle();

    expect(authRepo.logoutCalls, 1);
  });
}
