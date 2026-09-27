import Flutter
import GoogleMaps
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Google Maps SDK key (production-readiness slice) — see Info.plist's GMSApiKey / ios/Flutter/Local.xcconfig.example
    // and docs/PRODUCT_DECISIONS.md "Google Maps key architecture". Registered only when a real key is configured — the
    // SDK itself refuses an empty key, and until one is set, HATLY_MAPS_ENABLED must stay false (see AddressPinPicker) so
    // no GoogleMap widget is ever built without this having run.
    if let apiKey = Bundle.main.object(forInfoDictionaryKey: "GMSApiKey") as? String, !apiKey.isEmpty {
      GMSServices.provideAPIKey(apiKey)
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }
}
