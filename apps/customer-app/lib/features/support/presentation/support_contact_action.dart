import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/whatsapp_helper.dart';
import '../data/support_providers.dart';

/// Opens Hatly support on WhatsApp with an optional pre-filled [message]. Never throws: a missing number or a failed
/// launch (no WhatsApp / no browser / launcher error) shows a short, localized, non-blocking SnackBar instead.
/// Returns whether WhatsApp was opened.
Future<bool> openSupportWhatsApp(
  BuildContext context,
  WidgetRef ref, {
  String? message,
}) async {
  final l10n = AppLocalizations.of(context);
  final messenger = ScaffoldMessenger.maybeOf(context);
  void say(String text) => messenger
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  try {
    final contact = await ref.read(supportContactProvider.future);
    final number = contact.whatsappNumber;
    if (number == null) {
      say(l10n.supportContactUnavailable);
      return false;
    }
    final opened = await ref.read(whatsAppLauncherProvider)(
        buildWhatsAppUri(phoneNumber: number, message: message));
    if (!opened) say(l10n.supportContactLaunchFailed);
    return opened;
  } catch (_) {
    say(l10n.supportContactLaunchFailed);
    return false;
  }
}

/// The one reusable "contact Hatly" entry (Profile, Order Details, and — when it exists — Tracking). It is a quiet,
/// full-width row, not a floating or prominent button.
///
/// [messageBuilder] receives the localizations so each caller supplies its own localized text (general support vs
/// an order reference) while sharing the number lookup, launch and failure handling.
///
/// While the number loads, the row is shown disabled. If it turns out unavailable: [hideWhenUnavailable] hides the
/// row entirely (contextual entries, to avoid clutter); otherwise the row stays but is disabled and says why.
class SupportContactTile extends ConsumerStatefulWidget {
  const SupportContactTile({
    super.key,
    required this.label,
    required this.messageBuilder,
    this.hideWhenUnavailable = false,
  });

  final String label;
  final String Function(AppLocalizations l10n) messageBuilder;
  final bool hideWhenUnavailable;

  @override
  ConsumerState<SupportContactTile> createState() => _SupportContactTileState();
}

class _SupportContactTileState extends ConsumerState<SupportContactTile> {
  bool _launching = false;

  // Polish pass: was a plain callback with no in-flight guard — a fast
  // double-tap could fire two concurrent WhatsApp-launch attempts (and
  // two SnackBars on failure).
  Future<void> _handleTap(AppLocalizations l10n) async {
    if (_launching) return;
    setState(() => _launching = true);
    try {
      await openSupportWhatsApp(context, ref,
          message: widget.messageBuilder(l10n));
    } finally {
      if (mounted) setState(() => _launching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final contactAsync = ref.watch(supportContactProvider);
    final loading = contactAsync.isLoading;
    final available = contactAsync.valueOrNull?.isAvailable ?? false;

    if (!loading && !available && widget.hideWhenUnavailable) {
      return const SizedBox.shrink();
    }

    final enabled = available && !_launching;
    final subtitle = loading
        ? null
        : (available
            ? l10n.supportContactActionSubtitle
            : l10n.supportContactUnavailable);
    final color = enabled ? p.textPrimary : p.textMuted;

    return Semantics(
      container: true,
      button: true,
      enabled: enabled,
      label: subtitle == null ? widget.label : '${widget.label}، $subtitle',
      excludeSemantics: true,
      onTap: enabled ? () => _handleTap(l10n) : null,
      child: Material(
        color: p.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(HatlyRadius.card),
          side: BorderSide(color: p.border),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(HatlyRadius.card),
          onTap: enabled ? () => _handleTap(l10n) : null,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: HatlyTouch.minTarget),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                  horizontal: HatlySpacing.md, vertical: HatlySpacing.ms),
              child: Row(
                children: [
                  Icon(Icons.chat_outlined,
                      size: 22, color: enabled ? p.accent : p.textMuted),
                  const SizedBox(width: HatlySpacing.ms),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(widget.label,
                            style: context.type.body.copyWith(
                                color: color, fontWeight: FontWeight.w700)),
                        if (subtitle != null)
                          Text(subtitle, style: context.type.small),
                      ],
                    ),
                  ),
                  if (loading || _launching)
                    const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2))
                  else if (enabled) ...[
                    const SizedBox(width: HatlySpacing.sm),
                    Icon(Icons.arrow_outward_rounded,
                        size: 18, color: p.textMuted),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
