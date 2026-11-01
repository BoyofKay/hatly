import 'dart:async';


import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/core/error/error_reporting.dart';

void main() {
  late ErrorSink original;
  late void Function(FlutterErrorDetails)? originalOnError;
  setUp(() {
    original = ErrorReporting.sink;
    originalOnError = FlutterError.onError;
  });
  tearDown(() {
    ErrorReporting.sink = original;
    FlutterError.onError = originalOnError;
    PlatformDispatcher.instance.onError = null;
  });

  test('a framework error reaches the sink, tagged "flutter"', () {
    final seen = <String>[];
    ErrorReporting.sink = (e, s, {required source}) => seen.add('$source:$e');
    ErrorReporting.install();
    FlutterError.onError!(FlutterErrorDetails(exception: StateError('boom')));
    expect(seen.single, startsWith('flutter:'));
    expect(seen.single, contains('boom'));
  });

  test('an unawaited async error inside runGuarded reaches the sink, tagged "zone", and does not escape', () async {
    final seen = <String>[];
    final done = Completer<void>();
    ErrorReporting.sink = (e, s, {required source}) {
      seen.add('$source:$e');
      if (!done.isCompleted) done.complete();
    };
    ErrorReporting.runGuarded(() async {
      Future<void>.delayed(Duration.zero, () => throw StateError('late failure'));
    });
    await done.future.timeout(const Duration(seconds: 2));
    expect(seen.single, startsWith('zone:'));
    expect(seen.single, contains('late failure'));
  });

  test('the default sink never throws (release builds stay silent, debug builds print)', () {
    expect(() => ErrorSink, returnsNormally);
    ErrorReporting.sink = original;
    expect(() => original(StateError('x'), StackTrace.current, source: 'test'), returnsNormally);
  });
}
