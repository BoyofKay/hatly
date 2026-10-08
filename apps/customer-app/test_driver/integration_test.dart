import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

/// Host side of `flutter drive`: saves every screenshot the on-device test takes to `build/marketplace-screens/`.
Future<void> main() => integrationDriver(
      onScreenshot: (String name, List<int> bytes, [Map<String, Object?>? args]) async {
        final file = File('build/marketplace-screens/$name.png');
        file.createSync(recursive: true);
        file.writeAsBytesSync(bytes);
        return true;
      },
    );
