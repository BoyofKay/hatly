import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/localization/bilingual.dart';
import '../deliveries/data/driver_providers.dart';
import '../../core/utils/money.dart';
import 'shift_api.dart';
import 'shift_duration_label.dart';

/// Driver shifts (owner decision 2026-11-22): replaces the online switch. Off duty → "Start shift". On duty → since when, a
/// "take new orders" switch (switch it off to finish what you carry and receive nothing new) and "End shift" — refused, with the
/// reason, while an order is with you or something is still to settle (then the shift ends at the office with the closing).
class ShiftCard extends ConsumerStatefulWidget {
  const ShiftCard({super.key, required this.state});
  final ShiftState state;

  @override
  ConsumerState<ShiftCard> createState() => _ShiftCardState();
}

class _ShiftCardState extends ConsumerState<ShiftCard> {
  bool _busy = false;
  String? _message;

  String _reason(BuildContext context, String? code, ShiftState s) {
    switch (code) {
      case 'SHIFT_HAS_ACTIVE_ORDERS':
      case 'HAS_ACTIVE_ORDERS':
        return context.t(
            'You still have ${s.activeOrders} order(s). Finish them first — switch off "new orders" so no more come.',
            'معك ${s.activeOrders} طلب. أنهِها أولًا — أوقف «طلبات جديدة» حتى لا تصلك طلبات أخرى.');
      case 'SHIFT_NOT_SETTLED':
      case 'NOT_SETTLED':
        return context.t(
            'You have ${s.unsettledOrders} delivered order(s) not settled yet. End your shift at the office with the shift closing.',
            'لديك ${s.unsettledOrders} طلب مُسلَّم لم تتم تسويته بعد. أنهِ ورديتك في المكتب مع تقفيل الوردية.');
      case 'SHIFT_ALLOWANCE_OUT':
      case 'ALLOWANCE_OUT':
        return context.t(
            'You still hold the daily allowance (${formatMinor(s.allowanceOutMinor)}). Return it at the office to end your shift.',
            'معك العهدة اليومية (${formatMinor(s.allowanceOutMinor, arabic: true)}). سلّمها في المكتب لإنهاء ورديتك.');
      case 'DRIVER_NOT_APPROVED':
        return context.t(
            'Your account is not approved yet. Contact Hatly operations.',
            'حسابك لم يُعتمد بعد. تواصل مع تشغيل هاتلي.');
      default:
        return context.t('Could not update your shift. Please try again.',
            'تعذّر تحديث ورديتك. حاول مرة أخرى.');
    }
  }

  Future<void> _run(Future<ShiftState> Function() op, {bool? goOnline}) async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await op();
      // The location timer follows the duty state (the existing online notifier starts / stops it).
      if (goOnline != null)
        await ref.read(driverOnlineStateProvider.notifier).setOnline(goOnline);
      ref.invalidate(shiftStateProvider);
    } on ShiftRefused catch (e) {
      if (mounted)
        setState(() => _message = _reason(context, e.code, widget.state));
      ref.invalidate(shiftStateProvider);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.state;
    final api = ref.read(shiftApiProvider);
    final green = const Color(0xFF2E7D32);
    final since = s.startedAt?.toLocal();
    // A Material (not a decorated box) so the switch row's tap ink shows on the coloured card.
    return Padding(
      key: const Key('shift-card'),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Material(
        color: s.onDuty ? const Color(0xFFE8F5E9) : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
              color:
                  s.onDuty ? const Color(0xFF81C784) : const Color(0xFFE0E0E0)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(children: [
                Icon(s.onDuty ? Icons.badge : Icons.badge_outlined,
                    color: s.onDuty ? green : Colors.grey),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    s.onDuty
                        ? '${context.t('On duty', 'في الخدمة')}${since == null ? '' : ' · ${context.t('since', 'منذ')} ${since.hour.toString().padLeft(2, '0')}:${since.minute.toString().padLeft(2, '0')}'}'
                        : context.t('Off duty', 'خارج الخدمة'),
                    key: const Key('shift-status'),
                    style: TextStyle(
                        fontWeight: FontWeight.w800,
                        color: s.onDuty
                            ? const Color(0xFF1B5E20)
                            : const Color(0xFF424242)),
                  ),
                ),
              ]),
              if (s.allowanceOutMinor > 0)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Row(children: [
                    const Icon(Icons.account_balance_wallet_outlined, size: 18, color: Color(0xFF8D6E00)),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        context.t('Daily allowance with you: ${formatMinor(s.allowanceOutMinor)} — return it at the end of the shift',
                            'العهدة اليومية معك: ${formatMinor(s.allowanceOutMinor, arabic: true)} — تُرد في نهاية الوردية'),
                        key: const Key('shift-allowance'),
                        style: const TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF8D6E00)),
                      ),
                    ),
                  ]),
                ),
              if (s.onDuty) ...[
                const ShiftDurationLabel(),
                SwitchListTile(
                  key: const Key('accepting-switch'),
                  contentPadding: EdgeInsets.zero,
                  title:
                      Text(context.t('Take new orders', 'استقبال طلبات جديدة')),
                  subtitle: Text(s.acceptingNewOrders
                      ? context.t('New orders can be assigned to you.',
                          'يمكن إسناد طلبات جديدة إليك.')
                      : context.t(
                          'No new orders — finish what you carry, then end your shift.',
                          'لا طلبات جديدة — أنهِ ما معك ثم أنهِ ورديتك.')),
                  value: s.acceptingNewOrders,
                  onChanged: _busy
                      ? null
                      : (v) => _run(() => api.setAcceptingNewOrders(v)),
                ),
                OutlinedButton(
                  key: const Key('end-shift'),
                  onPressed:
                      _busy ? null : () => _run(api.end, goOnline: false),
                  child: Text(context.t('End shift', 'إنهاء الوردية')),
                ),
              ] else
                FilledButton(
                  key: const Key('start-shift'),
                  onPressed:
                      _busy ? null : () => _run(api.start, goOnline: true),
                  child: Text(context.t('Start shift', 'ابدأ الوردية')),
                ),
              if (_message != null) ...[
                const SizedBox(height: 8),
                Text(_message!,
                    key: const Key('shift-message'),
                    style: TextStyle(color: Colors.red.shade700)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
