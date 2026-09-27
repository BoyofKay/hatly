import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/shell/presentation/customer_shell.dart';
import 'package:hatly_customer/features/shell/presentation/shell_tab_provider.dart';

void main() {
  group('bottom navigation keeps the EXISTING navigation architecture', () {
    test('tab indices are unchanged', () {
      expect([
        ShellTab.home,
        ShellTab.search,
        ShellTab.orders,
        ShellTab.favorites,
        ShellTab.profile
      ], [
        0,
        1,
        2,
        3,
        4
      ]);
    });

    test(
        'bar = Home · Explore(search tab) · Cart(pushes /cart, no tab) · Orders · Profile',
        () {
      expect(CustomerShell.barToTab, [
        ShellTab.home,
        ShellTab.search,
        null,
        ShellTab.orders,
        ShellTab.profile
      ]);
    });

    test(
        'each tab highlights its bar item; Favorites (no bar item) highlights nothing; Cart is never selected',
        () {
      expect(CustomerShell.barIndexForTab(ShellTab.home), 0);
      expect(CustomerShell.barIndexForTab(ShellTab.search), 1);
      expect(CustomerShell.barIndexForTab(ShellTab.orders), 3);
      expect(CustomerShell.barIndexForTab(ShellTab.profile), 4);
      expect(CustomerShell.barIndexForTab(ShellTab.favorites), isNull);
      for (final tab in [0, 1, 2, 3, 4]) {
        expect(CustomerShell.barIndexForTab(tab), isNot(2));
      }
    });
  });
}
