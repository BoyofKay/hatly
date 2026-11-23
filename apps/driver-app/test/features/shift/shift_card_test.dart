import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/features/shift/shift_api.dart';
import 'package:hatly_driver/features/shift/shift_card.dart';

ShiftState _state({bool onDuty = true, bool accepting = true, int active = 0, int unsettled = 0}) => ShiftState(
      onDuty: onDuty,
      acceptingNewOrders: accepting,
      startedAt: onDuty ? DateTime(2026, 11, 22, 9, 5) : null,
      canEnd: active == 0 && unsettled == 0,
      endBlockedReason: active > 0 ? 'HAS_ACTIVE_ORDERS' : unsettled > 0 ? 'NOT_SETTLED' : null,
      activeOrders: active,
      unsettledOrders: unsettled,
    );

class _FakeShiftApi implements ShiftApi {
  _FakeShiftApi({this.refuseEndWith});
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
  final String? refuseEndWith;
  final calls = <String>[];
  @override
  Future<ShiftState> end() async {
    calls.add('end');
    if (refuseEndWith != null) throw ShiftRefused(refuseEndWith);
    return _state(onDuty: false);
  }

  @override
  Future<ShiftState> setAcceptingNewOrders(bool accepting) async {
    calls.add('accepting:$accepting');
    return _state(accepting: accepting);
  }
}

Future<void> _pump(WidgetTester tester, ShiftState s, _FakeShiftApi api) async {
  await tester.pumpWidget(ProviderScope(
    overrides: [shiftApiProvider.overrideWithValue(api)],
    child: MaterialApp(home: Scaffold(body: ShiftCard(state: s))),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('off duty shows "Start shift"', (tester) async {
    await _pump(tester, _state(onDuty: false), _FakeShiftApi());
    expect(find.text('Off duty'), findsOneWidget);
    expect(find.byKey(const Key('start-shift')), findsOneWidget);
    expect(find.byKey(const Key('end-shift')), findsNothing);
  });

  testWidgets('on duty: since when, the "take new orders" switch, and "End shift"', (tester) async {
    final api = _FakeShiftApi();
    await _pump(tester, _state(), api);
    expect(find.textContaining('On duty · since 09:05'), findsOneWidget);
    await tester.tap(find.byKey(const Key('accepting-switch')));
    await tester.pumpAndSettle();
    expect(api.calls, ['accepting:false']);
  });

  testWidgets('End shift refused while carrying orders explains why', (tester) async {
    final api = _FakeShiftApi(refuseEndWith: 'SHIFT_HAS_ACTIVE_ORDERS');
    await _pump(tester, _state(active: 2), api);
    await tester.tap(find.byKey(const Key('end-shift')));
    await tester.pumpAndSettle();
    expect(api.calls, ['end']);
    expect(find.textContaining('You still have 2 order(s)'), findsOneWidget);
  });

  testWidgets('End shift refused with unsettled money sends the driver to the office closing', (tester) async {
    final api = _FakeShiftApi(refuseEndWith: 'SHIFT_NOT_SETTLED');
    await _pump(tester, _state(unsettled: 3), api);
    await tester.tap(find.byKey(const Key('end-shift')));
    await tester.pumpAndSettle();
    expect(find.textContaining('at the office'), findsOneWidget);
  });
}
