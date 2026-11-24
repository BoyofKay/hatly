import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/core/utils/egypt_phone_number.dart';

void main() {
  test('Egyptian national input and international paste normalize identically', () {
    for (final raw in ['01012345678', '1012345678', '+201012345678', '00201012345678', '٠١٠١٢٣٤٥٦٧٨']) {
      expect(EgyptPhoneNumber.normalizeForAuth(raw), '+201012345678');
    }
    expect(EgyptPhoneNumber.normalizeForAuth('+966501234567'), '+966501234567');
    expect(EgyptPhoneNumber.normalizeForAuth('00966501234567'), '+966501234567');
    expect(EgyptPhoneNumber.normalizeForAuth('123'), isNull);
  });
}
