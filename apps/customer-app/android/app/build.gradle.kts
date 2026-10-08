import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// The Google Maps SDK key (production-readiness slice — see docs/PRODUCT_DECISIONS.md "Google Maps key architecture").
// A RESTRICTED MOBILE key (Android package name `com.hatly.customer` + the release keystore's SHA-1), never the
// server's own GOOGLE_MAPS_API_KEY (that one stays server-side, in the backend's .env, and is never shipped here).
// Read from `local.properties` (`MAPS_API_KEY=...`, already gitignored — never commit a real key there) or, for CI/CD, the
// `MAPS_API_KEY` environment variable. Left blank in dev: the app's own `HATLY_MAPS_ENABLED` flag (see
// `AddressPinPicker`) is what actually gates building a `GoogleMap` widget with it, so an unset key here is safe as long
// as that flag stays false — it is never silently swapped for a placeholder value.
val localProperties = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val mapsApiKey: String = (localProperties.getProperty("MAPS_API_KEY") ?: System.getenv("MAPS_API_KEY") ?: "")

// Release signing (M5 Batch 3). The upload/release keystore is NEVER in the repository: android/key.properties (git-ignored; see
// key.properties.example) points at it. Without that file the release variant falls back to the debug key, so local
// `flutter run --release` keeps working — such a build cannot be published (Play rejects debug-signed bundles), and a warning says so.
val keystoreProperties = Properties().apply {
    val file = rootProject.file("key.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val hasReleaseKeystore = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
    .all { !keystoreProperties.getProperty(it).isNullOrBlank() }

android {
    namespace = "com.hatly.customer"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.hatly.customer"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        // Fills the `${mapsApiKey}` placeholder in AndroidManifest.xml's `com.google.android.geo.API_KEY` meta-data —
        // the standard mechanism `google_maps_flutter` itself reads on Android. Blank is valid (see above).
        manifestPlaceholders["mapsApiKey"] = mapsApiKey
        // Tester builds only: a dev/tester backend served over plain http (e.g. http://<LAN IP>:3000) needs cleartext
        // traffic, which Android blocks by default. OFF unless explicitly requested with
        // `flutter build apk --android-project-arg=hatly.allowCleartext=true`; a normal (production) build never allows it.
        manifestPlaceholders["usesCleartextTraffic"] = (project.findProperty("hatly.allowCleartext") == "true").toString()
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                logger.warn("WARNING: android/key.properties not found — signing the RELEASE build with the DEBUG key. Not publishable.")
                signingConfigs.getByName("debug")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
