import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/core/config/api_config.dart';

void main() {
  group('apiBaseUrlProblem (release-build safety)', () {
    test('accepts staging/production/LAN backends', () {
      expect(apiBaseUrlProblem('https://api.hatly.example/api/v1'), isNull);
      expect(apiBaseUrlProblem('https://staging-api.hatly.example:8443/api/v1'),
          isNull);
      // Developer LAN builds use plain http on a private IP — must keep working.
      expect(apiBaseUrlProblem('http://192.168.1.23:3000/api/v1'), isNull);
    });

    test(
        'rejects the localhost build-time default and other this-device addresses',
        () {
      for (final url in [
        'http://localhost:3000/api/v1',
        'http://127.0.0.1:3000/api/v1',
        'http://10.0.2.2:3000/api/v1',
        'http://0.0.0.0:3000',
        'HTTP://LOCALHOST:3000/api/v1',
      ]) {
        expect(apiBaseUrlProblem(url), isNotNull, reason: url);
      }
      expect(
          apiBaseUrlProblem(
              kApiBaseUrl.isEmpty ? 'x' : 'http://localhost:3000/api/v1'),
          contains('local machine'));
    });

    test('rejects an empty or malformed URL', () {
      for (final url in [
        '',
        '   ',
        'not a url',
        '/api/v1',
        'api.hatly.example'
      ]) {
        expect(apiBaseUrlProblem(url), isNotNull, reason: url);
      }
    });
  });
}
