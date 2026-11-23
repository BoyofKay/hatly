import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/core/network/api_client.dart';
import 'package:hatly_driver/core/storage/token_storage.dart';
import 'package:hatly_driver/features/auth/presentation/auth_state_provider.dart';
import 'package:hatly_driver/features/auth/presentation/forced_password_change_screen.dart';

/// Owner decision 2026-11-23: a temporary password set by Hatly operations must be replaced before the driver can work.
class _Stub implements HttpClientAdapter {
  _Stub(this.status, this.body);
  final int status;
  final Map<String, dynamic> body;
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? s, Future<void>? c) async =>
      ResponseBody.fromString(jsonEncode(body), status, headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType]
      });
  @override
  void close({bool force = false}) {}
}

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('the API client reports PASSWORD_CHANGE_REQUIRED', () async {
    var told = 0;
    final client = ApiClient(baseUrl: 'http://x', tokenStorage: TokenStorage(), onPasswordChangeRequired: () => told++);
    client.dio.httpClientAdapter = _Stub(403, {
      'error': {
        'details': {'code': 'PASSWORD_CHANGE_REQUIRED'}
      }
    });
    await expectLater(client.dio.get('/driver/shift'), throwsA(isA<DioException>()));
    expect(told, 1);

    client.dio.httpClientAdapter = _Stub(403, {
      'error': {
        'details': {'code': 'FORBIDDEN'}
      }
    });
    await expectLater(client.dio.get('/driver/shift'), throwsA(isA<DioException>()));
    expect(told, 1);
  });

  test('the lock applies only to a signed-in driver, and lifts after the change', () async {
    final c = ProviderContainer();
    addTearDown(c.dispose);
    c.read(authStateProvider);
    await Future<void>.delayed(const Duration(milliseconds: 10));
    c.read(authStateProvider.notifier).requirePasswordChange();
    expect(c.read(authStateProvider).mustChangePassword, isFalse);
    c.read(authStateProvider.notifier).setAuthenticated(true, mustChangePassword: true);
    expect(c.read(authStateProvider).mustChangePassword, isTrue);
    c.read(authStateProvider.notifier).passwordChanged();
    expect(c.read(authStateProvider).mustChangePassword, isFalse);
    expect(c.read(authStateProvider).isAuthenticated, isTrue);
  });

  testWidgets('the screen checks the new password before sending', (tester) async {
    tester.view.physicalSize = const Size(390, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const ProviderScope(child: MaterialApp(home: ForcedPasswordChangeScreen())));
    await tester.pumpAndSettle();
    expect(find.text('Choose a new password'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('temp-password-current')), 'abcd-2345');
    await tester.enterText(find.byKey(const Key('temp-password-new')), 'short');
    await tester.tap(find.byKey(const Key('temp-password-save')));
    await tester.pump();
    expect(find.textContaining('at least 8'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('temp-password-new')), 'driver-own-1');
    await tester.enterText(find.byKey(const Key('temp-password-confirm')), 'driver-own-2');
    await tester.tap(find.byKey(const Key('temp-password-save')));
    await tester.pump();
    expect(find.textContaining('do not match'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('temp-password-new')), 'abcd-2345');
    await tester.enterText(find.byKey(const Key('temp-password-confirm')), 'abcd-2345');
    await tester.tap(find.byKey(const Key('temp-password-save')));
    await tester.pump();
    expect(find.textContaining('different from the temporary'), findsOneWidget);
  });
}
