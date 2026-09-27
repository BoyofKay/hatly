import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Wraps flutter_secure_storage so the rest of the app never touches
/// tokens directly (spec section 4: "secure local storage for
/// sensitive tokens"). Backed by Keychain on iOS / EncryptedSharedPreferences
/// on Android.
class TokenStorage {
  TokenStorage() : _storage = const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _accessTokenKey = 'hatly_access_token';
  static const _refreshTokenKey = 'hatly_refresh_token';
  static const _displayNameKey = 'hatly_display_name';

  Future<void> saveTokens(
      {required String accessToken, required String refreshToken}) async {
    await _storage.write(key: _accessTokenKey, value: accessToken);
    await _storage.write(key: _refreshTokenKey, value: refreshToken);
  }

  Future<String?> get accessToken => _storage.read(key: _accessTokenKey);
  Future<String?> get refreshToken => _storage.read(key: _refreshTokenKey);

  /// Caches the full name the customer typed during phone entry
  /// (features/auth/presentation/otp_flow_controller.dart), purely so
  /// Home can show "Hello, <name>" without a `GET /users/me` endpoint
  /// — which doesn't exist on the backend yet and isn't invented here.
  /// This is not sensitive data, but it's stored alongside the tokens
  /// for convenience and cleared together with them on logout.
  Future<void> saveDisplayName(String? name) async {
    if (name == null || name.isEmpty) return;
    await _storage.write(key: _displayNameKey, value: name);
  }

  Future<String?> get displayName => _storage.read(key: _displayNameKey);

  Future<void> clear() async {
    await _storage.delete(key: _accessTokenKey);
    await _storage.delete(key: _refreshTokenKey);
    await _storage.delete(key: _displayNameKey);
  }
}
