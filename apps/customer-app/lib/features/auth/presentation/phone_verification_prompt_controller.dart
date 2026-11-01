import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/auth_providers.dart';
import 'auth_gate.dart';

/// Customer Authentication Modes (master implementation) — Section 12.
/// Fetched once per app session via the new, minimal
/// `GET auth/customer/me` (see AuthApi.getPhoneVerificationStatus's own
/// comment for why this endpoint had to exist at all). `autoDispose`
/// so it re-fetches fresh if the widget tree watching it is torn down
/// and rebuilt (e.g. after a logout/login cycle), rather than caching
/// stale verification state across sessions.
///
/// A GUEST has no account and no phone to verify: this answers "nothing to verify" (the banner stays hidden) WITHOUT calling
/// the authenticated `customer/me` endpoint.
final phoneVerificationStatusProvider =
    FutureProvider.autoDispose<bool>((ref) async {
  if (!ref.watch(isSignedInProvider)) return true;
  final status =
      await ref.watch(authRepositoryProvider).getPhoneVerificationStatus();
  // `true` = "nothing to show". With OTP OFF verification is not possible, so an unverified customer is NOT invited to verify
  // (an instruction that cannot be followed) — and is not treated as verified either; the phone just stays unverified.
  return !status.shouldPrompt;
});

/// Session-only (never persisted) — if the Customer dismisses the
/// banner, it stays hidden for the rest of this app session but
/// reappears on next launch if still unverified. This is a UX
/// convenience, not a security mechanism — the backend remains the
/// sole authority on verification status.
final phoneVerificationDismissedProvider = StateProvider<bool>((ref) => false);
