import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/checkout/data/checkout_providers.dart';
import 'package:hatly_customer/features/checkout/data/manual_transfer_api.dart';
import 'package:hatly_customer/features/checkout/presentation/transfer_instructions_screen.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import '../../support/test_app.dart';

/// Polish pass regression coverage for TransferInstructionsScreen — a
/// screen that previously had no test coverage at all. Covers the two
/// real behaviour changes made in this pass: the error state gaining a
/// retry action, and the "Send Proof" button gaining an in-flight guard
/// against a fast double-tap.
class _FakeManualTransferApi implements ManualTransferApi {
  _FakeManualTransferApi({this.getConfigImpl});

  Future<ManualTransferConfig> Function()? getConfigImpl;
  int getConfigCalls = 0;
  int claimCalls = 0;
  Completer<void>? claimGate;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<ManualTransferConfig> getConfig() {
    getConfigCalls++;
    return (getConfigImpl ?? () async => _defaultConfig())();
  }

  @override
  Future<void> claimTransfer(String orderId) async {
    claimCalls++;
    if (claimGate != null) await claimGate!.future;
  }
}

ManualTransferConfig _defaultConfig() => const ManualTransferConfig(
      destination: ManualTransferDestination(
        label: 'InstaPay',
        phoneOrAccountNumber: '01000000000',
      ),
      whatsappNumber: '+201000000000',
    );

/// Fakes the platform side of `url_launcher` — this screen calls
/// `openWhatsAppWithMessage` (which calls `launchUrl` from url_launcher)
/// directly rather than through an injectable provider, so the only way
/// to observe/gate it in a widget test is faking the platform interface.
class _FakeUrlLauncherPlatform extends UrlLauncherPlatform {
  int launchCalls = 0;
  Completer<void>? gate;

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    launchCalls++;
    if (gate != null) await gate!.future;
    return true;
  }
}

Future<void> _pump(WidgetTester tester, _FakeManualTransferApi api) async {
  await tester.pumpWidget(hatlyTestApp(
    const TransferInstructionsScreen(
      orderId: 'o-1',
      totalMinor: 10000,
      paymentMethodLabel: 'InstaPay',
    ),
    locale: const Locale('en'),
    overrides: [
      manualTransferApiProvider.overrideWithValue(api),
    ],
  ));
  await tester.pumpAndSettle();
}

void main() {
  late UrlLauncherPlatform originalPlatform;

  setUp(() {
    originalPlatform = UrlLauncherPlatform.instance;
  });

  tearDown(() {
    UrlLauncherPlatform.instance = originalPlatform;
  });

  testWidgets(
      'error state offers a working retry (Polish pass: was a dead end)',
      (tester) async {
    var shouldFail = true;
    final api = _FakeManualTransferApi(getConfigImpl: () async {
      if (shouldFail) throw Exception('network down');
      return _defaultConfig();
    });
    await _pump(tester, api);

    expect(api.getConfigCalls, 1);
    expect(find.byIcon(Icons.error_outline), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);

    shouldFail = false;
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(api.getConfigCalls, 2);
    // The real destination content is now showing — the error state is gone.
    expect(find.text('InstaPay'), findsOneWidget);
  });

  testWidgets(
      'double-tapping "Send Proof" only opens WhatsApp once (Polish pass in-flight guard)',
      (tester) async {
    final fakeLauncher = _FakeUrlLauncherPlatform()..gate = Completer<void>();
    UrlLauncherPlatform.instance = fakeLauncher;
    final api = _FakeManualTransferApi();
    await _pump(tester, api);

    final sendProof = find.text('Send payment proof via WhatsApp');
    expect(sendProof, findsOneWidget);
    // Both taps fire before any frame is pumped in between — the button
    // itself hasn't yet rebuilt into its disabled state, so only the
    // screen's own `_isClaiming ? null : ...` guard (not a rebuilt
    // disabled FilledButton) is what stops the second launch.
    await tester.tap(sendProof);
    await tester.tap(sendProof);
    await tester.pump();
    fakeLauncher.gate!.complete();
    await tester.pumpAndSettle();

    expect(fakeLauncher.launchCalls, 1);
    expect(api.claimCalls, 1);
  });
}
