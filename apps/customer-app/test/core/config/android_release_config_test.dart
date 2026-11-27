import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Source-level guards for the Android release configuration (the built bundle is verified separately by scripts/launch/build-android-release.sh;
/// this catches a regression before anyone builds). Runs from the app root, as `flutter test` does.
void main() {
  final manifest = File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
  final gradle = File('android/app/build.gradle.kts').readAsStringSync();

  test('auto-backup is off and Android 12+ extraction rules exclude everything (sign-in tokens must never reach a backup)', () {
    expect(manifest, contains('android:allowBackup="false"'));
    expect(manifest, contains('android:dataExtractionRules="@xml/data_extraction_rules"'));
    final rules = File('android/app/src/main/res/xml/data_extraction_rules.xml').readAsStringSync();
    for (final section in ['cloud-backup', 'device-transfer']) {
      final block = RegExp('<$section>([\\s\\S]*?)</$section>').firstMatch(rules)?.group(1) ?? '';
      for (final domain in ['root', 'file', 'database', 'sharedpref', 'external']) {
        expect(block, contains('<exclude domain="$domain"'), reason: '$section must exclude $domain');
      }
    }
  });

  test('cleartext traffic is a build-time opt-in that defaults to off; the manifest is not debuggable', () {
    expect(manifest, contains(r'android:usesCleartextTraffic="${usesCleartextTraffic}"'));
    expect(gradle, contains('(project.findProperty("hatly.allowCleartext") == "true").toString()'));
    expect(manifest, isNot(contains('android:debuggable')));
  });

  test('only the permissions the app needs: internet, location (foreground), microphone (voice notes, asked only when recording) — no background location, advertising ID, contacts, SMS or storage', () {
    final declared = RegExp(r'<uses-permission android:name="([^"]+)"').allMatches(manifest).map((m) => m.group(1)).toSet();
    expect(declared, {'android.permission.INTERNET', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.RECORD_AUDIO'});
  });

  test('release signing comes from the git-ignored key.properties (never a path or password in the Gradle file) and falls back to debug only with a warning', () {
    expect(gradle, contains('rootProject.file("key.properties")'));
    expect(gradle, isNot(contains('storePassword = "')));
    expect(gradle, isNot(contains('keyPassword = "')));
    expect(gradle, contains('signing the RELEASE build with the DEBUG key'));
  });

  test('the Play / Firebase / Maps identity is dev.hatly.customer, while the code namespace and Kotlin package stay together at com.hatly.customer', () {
    // applicationId = what is installed and what Google Play, Firebase (google-services.json) and a Maps key restriction see.
    expect(gradle, contains('applicationId = "dev.hatly.customer"'));
    expect(gradle, isNot(contains('applicationId = "com.hatly.customer"')));
    // namespace = the code package (R, BuildConfig, `.MainActivity` in the manifest). Changing it needs the Kotlin file moved with it — keep them equal.
    final namespace = RegExp(r'namespace = "([^"]+)"').firstMatch(gradle)!.group(1)!;
    expect(namespace, 'com.hatly.customer');
    final activity = File('android/app/src/main/kotlin/${namespace.replaceAll('.', '/')}/MainActivity.kt');
    expect(activity.existsSync(), isTrue, reason: 'MainActivity.kt must live under the namespace package path');
    expect(activity.readAsStringSync(), contains('package $namespace'));
    expect(manifest, contains('android:name=".MainActivity"'));
  });

  test('the iOS bundle id was NOT part of the Android application-id change', () {
    final pbx = File('ios/Runner.xcodeproj/project.pbxproj').readAsStringSync();
    expect(pbx, contains('PRODUCT_BUNDLE_IDENTIFIER = com.hatly.customer;'));
    expect(pbx, isNot(contains('dev.hatly')));
  });

  test('the Google Services plugin is applied only when google-services.json exists (a build without Firebase must still work)', () {
    expect(gradle, contains('if (file("google-services.json").exists())'));
    expect(gradle, contains('apply(plugin = "com.google.gms.google-services")'));
  });
}
