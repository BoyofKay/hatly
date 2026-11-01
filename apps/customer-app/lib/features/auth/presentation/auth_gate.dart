import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_primary_button.dart';
import 'session_controller.dart';

/// Guest browsing support. The app has ONE auth architecture — [SessionController] + the router's redirect. A visitor with no
/// session is a *guest*: they can browse the public marketplace (see [isPublicGuestPath]) but nothing is created for them —
/// no account, no token, no fake "guest" session. Everything that needs an account either lives on a protected route (the
/// router sends the guest to sign-in and back) or is guarded in place with [requireSignIn].

/// Whether there is a real, signed-in customer session. Providers that load per-customer data (cart, favourites, saved
/// addresses) watch this so a guest never triggers an authenticated request.
final isSignedInProvider = Provider<bool>((ref) {
  return ref.watch(sessionControllerProvider
      .select((s) => s.status == SessionStatus.authenticated));
});

const kSignInPath = '/phone';
const kOtpPath = '/otp';
const kSplashPath = '/splash';

/// The routes a guest may open: the home shell (Home + Explore; its account tabs show a sign-in prompt), search, vendor
/// listing/details, and product / marketplace-product details. Everything else — cart, checkout, orders, profile, addresses,
/// wallet, loyalty, Hatly Service (it fills the cart) — needs an account.
final RegExp _publicGuestPath = RegExp(
    r'^/(search|vendors|vendors/[^/]+|products/[^/]+|catalog-products/[^/]+|home/products/(most-ordered|new|offers))?$');

bool isPublicGuestPath(String path) => _publicGuestPath.hasMatch(path);

/// A `from` (return path) is only honoured when it is an in-app absolute path; anything else (another host, a scheme, a
/// protocol-relative `//x`, or an auth/splash screen — which would loop) is ignored.
String? safeReturnPath(String? from) {
  if (from == null || from.isEmpty) return null;
  if (!from.startsWith('/') || from.startsWith('//')) return null;
  final path = Uri.tryParse(from)?.path;
  if (path == null) return null;
  if (path == kSignInPath || path == kOtpPath || path == kSplashPath) {
    return null;
  }
  return from;
}

/// `/phone?from=<encoded target>` — sign-in that returns to [target] afterwards (when it is a safe in-app path).
String signInLocation({String? returnTo}) {
  final safe = safeReturnPath(returnTo);
  return safe == null
      ? kSignInPath
      : '$kSignInPath?from=${Uri.encodeQueryComponent(safe)}';
}

/// Guard for an action on a public screen that needs an account (add to cart, favourite, custom request). Signed in: returns
/// true and the caller carries on. Guest: opens sign-in/register (returning to the current screen afterwards) and returns
/// false — nothing is sent to the backend and nothing is created.
bool requireSignIn(BuildContext context, WidgetRef ref) {
  if (ref.read(isSignedInProvider)) return true;
  // The current screen's own location (not the router's last "go" location, which a pushed page does not update).
  final here = GoRouterState.of(context).uri.toString();
  context.push(signInLocation(returnTo: here));
  return false;
}

/// Leaves the sign-in / registration pages once the customer is signed in — the ONE place that decides where they land.
///
/// The router's own redirect only re-evaluates the base location, so it cannot remove sign-in pages that were PUSHED on top of
/// the page the customer came from (a product, the Orders tab prompt, the code screen on top of the form): they would stay on
/// screen / in the back stack. So, from the top-most auth page:
///  1. pop every auth page (`/phone`, `/otp`) — the customer is back on the screen they started from, with Home (or whatever was
///     below) still underneath, and no stale sign-up page to come back to;
///  2. if nothing was underneath (the sign-in page was reached by a redirect, i.e. it is the only page), go to the `from` return
///     path, or Home;
///  3. if the origin differs from the page the customer was headed to (`from`), go to `from`.
/// Safe to call when the redirect already moved on (it does nothing off an auth page).
void leaveAuthFlow(GoRouter router, {String? from}) {
  final returnTo = safeReturnPath(from);
  String top() =>
      router.routerDelegate.currentConfiguration.last.matchedLocation;
  bool onAuthPage() => top() == kSignInPath || top() == kOtpPath;

  var guard = 0;
  while (onAuthPage() && router.canPop() && guard++ < 5) {
    router.pop();
  }
  if (onAuthPage()) {
    router.go(returnTo ?? '/');
    return;
  }
  if (returnTo != null && Uri.parse(returnTo).path != top()) {
    router.go(returnTo);
  }
}

/// Calls [leaveAuthFlow] once a session becomes authenticated while this auth page is the visible one. Deferred to after the
/// frame so a redirect that already replaced the page wins (the page is then unmounted and nothing happens).
void leaveAuthFlowWhenSignedIn(BuildContext context, WidgetRef ref,
    {required bool Function() isMounted}) {
  ref.listen(sessionControllerProvider, (previous, next) {
    if (previous?.status == SessionStatus.authenticated ||
        next.status != SessionStatus.authenticated) {
      return;
    }
    if (ModalRoute.of(context)?.isCurrent != true) {
      return; // only the top-most auth page navigates
    }
    // Everything the callback needs is read NOW: after a redirect replaced this page its context can still be mounted for a
    // moment but no longer has route state above it.
    final router = GoRouter.of(context);
    final from = GoRouterState.of(context).uri.queryParameters['from'];
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (isMounted()) leaveAuthFlow(router, from: from);
    });
  });
}

/// What a guest sees in a tab that needs an account (Orders, Favourites, Profile): a clear prompt, not an error and not a
/// network call.
class SignInRequiredView extends StatelessWidget {
  const SignInRequiredView({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return SafeArea(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(HatlySpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.person_outline_rounded, size: 56, color: p.textMuted),
              const SizedBox(height: HatlySpacing.md),
              Text(l10n.guestSignInTitle,
                  textAlign: TextAlign.center, style: context.type.h2),
              const SizedBox(height: HatlySpacing.sm),
              Text(l10n.guestSignInBody,
                  textAlign: TextAlign.center,
                  style: context.type.body.copyWith(color: p.textMuted)),
              const SizedBox(height: HatlySpacing.lg),
              HatlyPrimaryButton(
                key: const Key('guest-sign-in'),
                label: l10n.guestSignInAction,
                onPressed: () => context.push(kSignInPath),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
