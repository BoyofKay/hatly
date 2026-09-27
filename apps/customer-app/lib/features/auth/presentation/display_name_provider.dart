import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/auth_providers.dart';

/// The locally-cached display name (see TokenStorage.saveDisplayName)
/// for Home's greeting. `.autoDispose` + `FutureProvider` rather than
/// something loaded eagerly at session-restore time — it's read in
/// exactly one place (HomeScreen's greeting) and isn't needed for any
/// routing/auth decision, so it doesn't belong in SessionController.
final displayNameProvider = FutureProvider.autoDispose<String?>((ref) {
  return ref.watch(authRepositoryProvider).getDisplayName();
});
