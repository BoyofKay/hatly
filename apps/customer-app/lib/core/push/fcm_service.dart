import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

/// Customer Push Notifications (Chunk B). Thin wrapper over
/// `firebase_messaging` — role-agnostic by design, mirroring the
/// Driver app's own `FcmService`
/// (apps/driver-app/lib/core/push/fcm_service.dart) exactly, since
/// nothing about this class is Driver-specific. `firebase_core`/
/// `firebase_messaging` were already listed in pubspec.yaml but
/// completely unused before this chunk (no existing Firebase
/// initialization anywhere in this app).
///
/// A SINGLE instance is created once (see `fcmServiceProvider` in
/// core/network/providers.dart) and reused everywhere — CONFIRMED:
/// avoids double-calling `Firebase.initializeApp()` and avoids
/// registering the underlying FCM stream listeners twice (which would
/// risk duplicate tap-navigation). `onTokenReceived`/`onTokenRefreshed`
/// are set once at construction (registration never changes);
/// `onNotificationTapped` is mutable and set separately by the app
/// root once it has router access (see main.dart) — `initialize()`
/// itself is called from AuthStateNotifier, after login/session
/// restore, which does NOT have router access.
///
/// REQUIRES EXTERNAL SETUP (not fabricated here, per explicit
/// instruction): a real Firebase project, plus the generated platform
/// config files — `google-services.json` (Android,
/// android/app/google-services.json) and `GoogleService-Info.plist`
/// (iOS, ios/Runner/GoogleService-Info.plist) — placed in their
/// standard platform locations, along with the corresponding Gradle/
/// Xcode build-file wiring those files require. Neither this file nor
/// any other file in this chunk invents fake project IDs/credentials.
/// `Firebase.initializeApp()` will throw at runtime until those real
/// files exist — expected, not a bug in this code.
///
/// Deliberately does NOT show a custom in-app foreground banner —
/// that would need `flutter_local_notifications`, a dependency that
/// is NOT already present, and adding it would exceed "add only the
/// minimum necessary dependency." Foreground messages are received
/// (so a future addition can hook in cleanly) but intentionally
/// produce no UI here, matching "do not create a notification center."
class FcmService {
  FcmService({
    required this.onTokenReceived,
    required this.onTokenRefreshed,
  });

  final void Function(String token) onTokenReceived;
  final void Function(String token) onTokenRefreshed;

  /// Set once by the app root (main.dart), after the router exists —
  /// defaults to a no-op so `initialize()` can safely run before that
  /// assignment happens (e.g. triggered by a restored session before
  /// the widget tree finishes building).
  void Function(Map<String, dynamic> data) onNotificationTapped = (_) {};

  bool _initialized = false;

  /// Safe to call more than once (e.g. both on session-restore and a
  /// fresh login within the same app run) — CONFIRMED idempotent via
  /// the internal guard below; `Firebase.initializeApp()` itself is
  /// also documented as idempotent, but the guard additionally avoids
  /// re-registering the stream listeners a second time.
  Future<void> initialize() async {
    if (_initialized) return;
    _initialized = true;

    await Firebase.initializeApp();

    // iOS requires explicit permission; most Android versions grant
    // by default (a no-op there), so this call is safe on both.
    await FirebaseMessaging.instance.requestPermission();

    final token = await FirebaseMessaging.instance.getToken();
    if (token != null) {
      onTokenReceived(token);
    }

    // Token refresh — CONFIRMED (Section 6): re-registers without
    // requiring the Driver to log out/in again.
    FirebaseMessaging.instance.onTokenRefresh.listen(onTokenRefreshed);

    // Foreground: app already open when the push arrives. No
    // duplicate navigation, no notification-center UI — see this
    // class's own top comment.
    FirebaseMessaging.onMessage.listen((_) {});

    // Tapped while the app was backgrounded (not terminated).
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      onNotificationTapped(message.data);
    });

    // Tapped from a fully terminated state — available immediately
    // after Firebase.initializeApp() on cold start.
    final initialMessage = await FirebaseMessaging.instance.getInitialMessage();
    if (initialMessage != null) {
      onNotificationTapped(initialMessage.data);
    }
  }
}
