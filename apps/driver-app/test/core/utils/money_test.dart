import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/core/utils/money.dart';

void main() {
  group('formatMinor', () {
    test('whole minor units, never floating point', () {
      expect(formatMinor(10000), '100.00 EGP');
      expect(formatMinor(4005), '40.05 EGP');
      expect(formatMinor(-250), '-2.50 EGP');
      expect(formatMinor(1999, arabic: true), '19.99 ج.م');
    });
    test('a missing amount is a dash, not zero', () => expect(formatMinor(null), '—'));
  });

  group('parseEgpToMinor', () {
    test('plain amounts are exact', () {
      expect(parseEgpToMinor('40'), 4000);
      expect(parseEgpToMinor('40.5'), 4050);
      expect(parseEgpToMinor('40.05'), 4005);
      expect(parseEgpToMinor(' 0.1 '), 10);
      // The classic double trap: 19.99 * 100 is 1998.9999999999998 in floating point.
      expect(parseEgpToMinor('19.99'), 1999);
      expect(parseEgpToMinor('1.15'), 115);
    });
    test('Arabic digits and separators', () {
      expect(parseEgpToMinor('٤٠٫٥٠'), 4050);
      expect(parseEgpToMinor('40,50'), 4050);
    });
    test('anything else is rejected, never rounded', () {
      for (final bad in ['', 'abc', '0', '-5', '1.234', '1.2.3', '12 EGP', '1e3']) {
        expect(parseEgpToMinor(bad), isNull, reason: bad);
      }
    });
  });

  test('formatGrams', () {
    expect(formatGrams(250), '250 g');
    expect(formatGrams(1000), '1 kg');
    expect(formatGrams(1500), '1.5 kg');
    expect(formatGrams(1250, arabic: true), '1.25 كجم');
  });
}
