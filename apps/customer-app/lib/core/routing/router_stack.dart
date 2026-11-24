import 'package:go_router/go_router.dart';
import 'package:flutter/widgets.dart';

/// Navigation helpers that keep the route STACK sound when a screen is opened from somewhere that is not a normal in-app tap
/// (a push-notification deep link, the end of checkout).
///
/// The problem they solve: `router.go('/orders/:id')` REPLACES the whole stack, so Order Details became the only route — no
/// back arrow, and Android's system Back would close the app instead of returning to Home. Every such entry point now goes
/// through here, in one place, instead of each caller hand-rolling `go` / `push`.
extension HatlyRouterStack on GoRouter {
  /// The location of the route currently on top of the stack. After an imperative `push` the configuration's own `uri` still
  /// reports the page beneath, so the LAST match (the one on top) is read instead.
  String get topLocation =>
      routerDelegate.currentConfiguration.last.matchedLocation;

  /// Opens [path] ON TOP of the current stack, making sure there is a Home route beneath it:
  ///  * already showing [path] → nothing (no duplicate Order Details when the same notification is delivered twice);
  ///  * [path] would be the only route (cold-start deep link) → Home is put underneath first, so Back goes Home;
  ///  * otherwise → a plain push, so Back returns to wherever the customer was.
  void openOnTopOfHome(String path) {
    final top = topLocation;
    if (top == path) return;
    if (top != '/' && !canPop()) go('/');
    push<void>(path);
  }

  /// Leaves the current flow for [path] with Home as the base of the stack (e.g. after checkout): the flow screens are gone,
  /// Back from [path] returns to Home — never to the checkout that already finished.
  void replaceFlowWith(String path) {
    go('/');
    push<void>(path);
  }
}

/// Handles an externally opened sole route without letting system Back exit.
/// Normal Navigator pops (including dialogs and sheets) take precedence.
class CustomerBackButtonDispatcher extends RootBackButtonDispatcher {
  CustomerBackButtonDispatcher(this.router);
  final GoRouter router;
  @override
  Future<bool> didPopRoute() async {
    if (await super.didPopRoute()) return true;
    if (router.routerDelegate.currentConfiguration.matches.isNotEmpty && router.topLocation != '/') {
      router.go('/');
    }
    // Home itself owns the deliberate two-gesture exit via PopScope.
    return true;
  }
}
