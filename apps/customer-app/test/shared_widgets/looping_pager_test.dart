import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/shared_widgets/looping_pager.dart';

import '../support/test_app.dart';

Widget _pager({
  int count = 3,
  Duration interval = const Duration(days: 1),
  ValueChanged<int>? onIndex,
  TextDirection direction = TextDirection.ltr,
}) =>
    hatlyTestApp(
      Directionality(
        textDirection: direction,
        child: SizedBox(
          height: 120,
          child: LoopingPager(
            count: count,
            autoPlayInterval: interval,
            onIndexChanged: onIndex,
            itemBuilder: (_, i) => Center(child: Text('item-$i', key: Key('item-$i'))),
          ),
        ),
      ),
    );

/// A fling that moves one page "forward" in the reading direction of [direction].
Future<void> _next(WidgetTester t, {TextDirection direction = TextDirection.ltr}) async {
  await t.fling(find.byType(PageView), Offset(direction == TextDirection.ltr ? -500 : 500, 0), 1500);
  await t.pumpAndSettle();
}

Future<void> _previous(WidgetTester t, {TextDirection direction = TextDirection.ltr}) async {
  await t.fling(find.byType(PageView), Offset(direction == TextDirection.ltr ? 500 : -500, 0), 1500);
  await t.pumpAndSettle();
}

void main() {
  testWidgets('swiping forward past the last item shows the first again — no rewind, no blank page', (t) async {
    final seen = <int>[];
    await t.pumpWidget(_pager(onIndex: seen.add));
    expect(find.byKey(const Key('item-0')), findsOneWidget);
    for (var i = 0; i < 7; i++) {
      await _next(t);
    }
    // 0 → 1 → 2 → 0 → 1 → 2 → 0 → 1 (every step is the next item, wrapping through the end)
    expect(seen, [1, 2, 0, 1, 2, 0, 1]);
    expect(find.byKey(const Key('item-1')), findsOneWidget);
  });

  testWidgets('swiping BACK from the first item shows the last, and keeps going', (t) async {
    final seen = <int>[];
    await t.pumpWidget(_pager(onIndex: seen.add));
    for (var i = 0; i < 4; i++) {
      await _previous(t);
    }
    expect(seen, [2, 1, 0, 2]);
    expect(find.byKey(const Key('item-2')), findsOneWidget);
  });

  testWidgets('right-to-left: the same endless loop, forward is the reading direction', (t) async {
    final seen = <int>[];
    await t.pumpWidget(_pager(onIndex: seen.add, direction: TextDirection.rtl));
    for (var i = 0; i < 4; i++) {
      await _next(t, direction: TextDirection.rtl);
    }
    expect(seen, [1, 2, 0, 1]);
    await _previous(t, direction: TextDirection.rtl);
    expect(seen.last, 0);
  });

  testWidgets('auto-play only ever moves forward, through the end, and pauses while a finger is down', (t) async {
    final seen = <int>[];
    await t.pumpWidget(_pager(interval: const Duration(seconds: 5), onIndex: seen.add));
    for (var i = 0; i < 4; i++) {
      await t.pump(const Duration(seconds: 5));
      await t.pumpAndSettle();
    }
    expect(seen, [1, 2, 0, 1]); // never 2 → 0 by sliding back across everything: each step is +1

    final gesture = await t.startGesture(t.getCenter(find.byType(PageView)));
    await gesture.moveBy(const Offset(-40, 0));
    await t.pump(const Duration(seconds: 20)); // a finger is down: the timer must not move the page
    expect(seen.length, 4);
    await gesture.up();
    await t.pumpAndSettle();
  });

  testWidgets('one item is a plain page: it does not loop or auto-play, and nothing throws', (t) async {
    await t.pumpWidget(_pager(count: 1, interval: const Duration(seconds: 1)));
    await t.pump(const Duration(seconds: 5));
    expect(find.byKey(const Key('item-0')), findsOneWidget);
    await t.fling(find.byType(PageView), const Offset(-500, 0), 1500);
    await t.pumpAndSettle();
    expect(find.byKey(const Key('item-0')), findsOneWidget);
  });

  testWidgets('a list that changes length restarts on its first item and never throws', (t) async {
    final seen = <int>[];
    await t.pumpWidget(_pager(onIndex: seen.add));
    await _next(t);
    await t.pumpWidget(_pager(count: 5, onIndex: seen.add));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('item-0')), findsOneWidget);
    expect(seen.last, 0);
  });

  testWidgets('does not auto-play when the OS asks for reduced motion', (t) async {
    t.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
    addTearDown(t.platformDispatcher.clearAccessibilityFeaturesTestValue);
    final seen = <int>[];
    await t.pumpWidget(_pager(interval: const Duration(seconds: 2), onIndex: seen.add));
    await t.pump(const Duration(seconds: 10));
    expect(seen, isEmpty);
  });
}
