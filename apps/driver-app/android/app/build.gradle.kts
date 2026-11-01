import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Firebase Cloud Messaging needs the Google Services plugin to turn android/app/google-services.json (git-ignored, supplied by the owner
// from the Firebase console) into the app's Firebase options. Applied ONLY when that file exists, so a build without it — today's state,
// and every developer build — is unchanged and push simply stays off (FcmService is wrapped defensively).
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

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
    namespace = "com.hatly.driver"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Matches the Customer app's own identity scheme (com.hatly.customer) — see
        // apps/customer-app/android/app/build.gradle.kts. No package/bundle identifier
        // was defined anywhere for the Driver app before M4 (confirmed via inspection);
        // this is a fresh, non-production-committed choice, consistent with the sibling app.
        applicationId = "com.hatly.driver"
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
        // Tester builds only (same switch as the Customer app): allow cleartext http to a dev/tester backend only when
        // built with `--android-project-arg=hatly.allowCleartext=true`; a normal (production) build never allows it.
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
