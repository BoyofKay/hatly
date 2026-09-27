import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/auth_providers.dart';

/// Customer Authentication Modes (master implementation) — Section 12.
/// Fetched once per app session via the new, minimal
/// `GET auth/customer/me` (see AuthApi.getIsPhoneVerified's own
/// comment for why this endpoint had to exist at all). `autoDispose`
/// so it re-fetches fresh if the widget tree watching it is torn down
/// and rebuilt (e.g. after a logout/login cycle), rather than caching
/// stale verification state across sessions.
final phoneVerificationStatusProvider = FutureProvider.autoDispose<bool>((ref) {
  return ref.watch(authRepositoryProvider).getIsPhoneVerified();
});

/// Session-only (never persisted) — if the Customer dismisses the
/// banner, it stays hidden for the rest of this app session but
/// reappears on next launch if still unverified. This is a UX
/// convenience, not a security mechanism — the backend remains the
/// sole authority on verification status.
final phoneVerificationDismissedProvider = StateProvider<bool>((ref) => false);
