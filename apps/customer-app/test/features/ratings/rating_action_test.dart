import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/ratings/data/rating_api.dart';
import 'package:hatly_customer/features/ratings/presentation/widgets/rating_action.dart';

import '../../support/test_app.dart';

/// The post-delivery rating row/sheet (vendor and product ratings share it). It is customer-facing in the closed test, and had no test:
/// what is submitted, what a customer sees on a validation error or a failed request, and that a finished rating is read-only.
void main() {
  Widget host({
    required Future<void> Function(int, String?) onSubmit,
    bool alreadyRated = false,
    SubmittedRating? existing,
    Locale locale = const Locale('en'),
  }) =>
      hatlyTestApp(
        RatingAction(label: 'Rate Abu Aly Grills', alreadyRated: alreadyRated, existingRating: existing, onSubmit: onSubmit),
        locale: locale,
      );

  Future<void> openSheet(WidgetTester tester) async {
    await tester.tap(find.text('Rate'));
    await tester.pumpAndSettle();
  }

  testWidgets('submitting without choosing stars shows the prompt and sends nothing', (tester) async {
    var calls = 0;
    await tester.pumpWidget(host(onSubmit: (_, __) async => calls++));
    await openSheet(tester);
    await tester.tap(find.text('Submit rating'));
    await tester.pumpAndSettle();
    expect(find.text('Select a rating'), findsOneWidget);
    expect(calls, 0);
  });

  testWidgets('stars + comment are submitted once, trimmed; the sheet closes and a confirmation shows', (tester) async {
    final sent = <(int, String?)>[];
    await tester.pumpWidget(host(onSubmit: (s, c) async => sent.add((s, c))));
    await openSheet(tester);
    await tester.tap(find.bySemanticsLabel('4'));
    await tester.enterText(find.byType(TextField), '  great food  ');
    await tester.tap(find.text('Submit rating'));
    await tester.pumpAndSettle();
    expect(sent, [(4, 'great food')]);
    expect(find.text('Submit rating'), findsNothing); // sheet closed
    expect(find.text('Rating submitted'), findsOneWidget);
  });

  testWidgets('a blank comment is sent as null, not as an empty string', (tester) async {
    final sent = <(int, String?)>[];
    await tester.pumpWidget(host(onSubmit: (s, c) async => sent.add((s, c))));
    await openSheet(tester);
    await tester.tap(find.bySemanticsLabel('5'));
    await tester.enterText(find.byType(TextField), '   ');
    await tester.tap(find.text('Submit rating'));
    await tester.pumpAndSettle();
    expect(sent, [(5, null)]);
  });

  testWidgets('a failed submit keeps the sheet open with a generic error and lets the customer try again (no raw error text)', (tester) async {
    var attempts = 0;
    await tester.pumpWidget(host(onSubmit: (_, __) async {
      attempts++;
      if (attempts == 1) throw Exception('SQLSTATE 23505 internal detail');
    }));
    await openSheet(tester);
    await tester.tap(find.bySemanticsLabel('3'));
    await tester.tap(find.text('Submit rating'));
    await tester.pumpAndSettle();
    expect(find.text('Something went wrong'), findsOneWidget);
    expect(find.textContaining('SQLSTATE'), findsNothing);
    expect(find.text('Submit rating'), findsOneWidget); // still open, button enabled again
    await tester.tap(find.text('Submit rating'));
    await tester.pumpAndSettle();
    expect(attempts, 2);
    expect(find.text('Rating submitted'), findsOneWidget);
  });

  testWidgets('an already-rated item shows the rating read-only: no rate button, stars and the comment are displayed', (tester) async {
    await tester.pumpWidget(host(onSubmit: (_, __) async {}, alreadyRated: true, existing: const SubmittedRating(stars: 4, comment: 'Lovely')));
    expect(find.text('Rate'), findsNothing);
    expect(find.text('Your rating'), findsOneWidget);
    expect(find.text('Lovely'), findsOneWidget);
    expect(find.byIcon(Icons.star), findsNWidgets(4));
    expect(find.byIcon(Icons.star_border), findsNWidgets(1));
  });

  testWidgets('the rating sheet lays out in Arabic (RTL) at 2x text without overflow', (tester) async {
    await tester.pumpWidget(hatlyTestApp(
      RatingAction(label: 'قيّم المتجر', alreadyRated: false, existingRating: null, onSubmit: (_, __) async {}),
      textScale: 2.0,
    ));
    await tester.tap(find.byType(TextButton));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byType(TextField), findsOneWidget);
  });
}
