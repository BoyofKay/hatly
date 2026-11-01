import 'dart:async';

import 'package:flutter/foundation.dart';

/// Where an uncaught error is delivered. The default sink only prints in debug builds: error text can carry personal data (phone
/// numbers and addresses inside request URLs/bodies), so nothing is written anywhere in release builds until a crash-reporting
/// service is chosen and its sink is assigned to [ErrorReporting.sink] (the one line to change; see docs/launch/LAUNCH_PROGRESS.md).
typedef ErrorSink = void Function(Object error, StackTrace? stack, {required String source});

/// Launch-readiness G-22: before this, an exception thrown outside a widget build (a Future nobody awaited, a platform callback,
/// a stream listener) was invisible — no handler, no hook for reporting. All three Flutter error channels now end in one sink.
class ErrorReporting {
  ErrorReporting._();

  static ErrorSink sink = _defaultSink;

  static void _defaultSink(Object error, StackTrace? stack, {required String source}) {
    if (kDebugMode) debugPrint('[Hatly][$source] $error\n${stack ?? ''}');
  }

  /// Framework errors (build/layout/paint) and errors that escape to the platform dispatcher (async code outside any zone).
  static void install() {
    final previous = FlutterError.onError;
    FlutterError.onError = (FlutterErrorDetails details) {
      if (kDebugMode) previous?.call(details); // keeps the red-screen/console output while developing
      sink(details.exception, details.stack, source: 'flutter');
    };
    PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
      sink(error, stack, source: 'platform');
      return true; // handled — do not terminate the app for a stray async error
    };
  }

  /// Runs [body] (the whole of `main` after the fail-fast configuration checks) in a zone whose uncaught errors reach [sink].
  static void runGuarded(Future<void> Function() body) {
    runZonedGuarded<Future<void>>(() async {
      install();
      await body();
    }, (Object error, StackTrace stack) => sink(error, stack, source: 'zone'));
  }
}
