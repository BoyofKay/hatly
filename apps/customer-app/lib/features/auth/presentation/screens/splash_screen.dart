import 'package:flutter/material.dart';
import '../../../../core/theme/hatly_theme.dart';

/// Shown only while SessionController is restoring (checking secure
/// storage for a persisted session) — the router keeps the user here
/// until that resolves, then redirects to either the phone-entry
/// screen or the authenticated shell. Not a marketing splash; this is
/// purely a loading state with brand treatment.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: HatlyColors.primaryOrange,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'هاتلي',
              style: TextStyle(
                color: HatlyColors.surfaceWhite,
                fontSize: 36,
                fontWeight: FontWeight.bold,
              ),
            ),
            SizedBox(height: 24),
            CircularProgressIndicator(color: HatlyColors.surfaceWhite),
          ],
        ),
      ),
    );
  }
}
