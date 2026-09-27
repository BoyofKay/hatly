import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../../../core/utils/whatsapp_helper.dart';
import 'support_contact_api.dart';

final supportContactApiProvider = Provider<SupportContactApi>(
    (ref) => SupportContactApi(ref.watch(apiClientProvider)));

/// The support contact, loaded from the backend (never hardcoded). A failed load is NOT surfaced as an error: it
/// resolves to "unavailable" so the UI hides/disables the action and no backend detail ever reaches the customer.
final supportContactProvider =
    FutureProvider.autoDispose<SupportContact>((ref) async {
  try {
    return await ref.watch(supportContactApiProvider).getContact();
  } catch (_) {
    return const SupportContact();
  }
});

/// How a WhatsApp link is opened — overridable in tests.
final whatsAppLauncherProvider =
    Provider<WhatsAppLauncher>((ref) => launchWhatsAppUri);
