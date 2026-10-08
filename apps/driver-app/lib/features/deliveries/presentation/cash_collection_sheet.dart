import 'package:flutter/material.dart';

class CashCollectionResult {
  const CashCollectionResult({required this.cashReceivedMinor});

  final int cashReceivedMinor;
}

/// M4 — Cash remainder / over-collection. Captures how much cash the driver
/// actually received at the door for a COD/PAY_AT_DELIVERY order, pre-filled with
/// the exact amount due. Exact change needs no further action; the caller
/// (`delivery_detail_screen.dart`) only calls `DriverApi.submitCashRemainder` when
/// the confirmed amount exceeds `amountDueMinor` — the backend itself refuses a
/// submission with no real remainder (`NO_REMAINDER`), so this sheet never even
/// attempts one for exact change.
///
/// All money here is integer minor units (piasters) — the text field is the only
/// place a whole/fractional EGP value briefly exists, converted immediately back
/// to minor units, matching the same convention `_recordPurchaseAmount` already
/// uses on this screen.
class CashCollectionSheet extends StatefulWidget {
  const CashCollectionSheet({super.key, required this.amountDueMinor});

  final int amountDueMinor;

  @override
  State<CashCollectionSheet> createState() => _CashCollectionSheetState();
}

class _CashCollectionSheetState extends State<CashCollectionSheet> {
  late final TextEditingController _controller =
      TextEditingController(text: (widget.amountDueMinor / 100).toStringAsFixed(2));
  String? _error;

  int? get _cashReceivedMinor {
    final value = double.tryParse(_controller.text.trim());
    if (value == null) return null;
    return (value * 100).round();
  }

  int get _changeMinor {
    final received = _cashReceivedMinor;
    if (received == null) return 0;
    final change = received - widget.amountDueMinor;
    return change > 0 ? change : 0;
  }

  void _confirm() {
    final received = _cashReceivedMinor;
    if (received == null || received <= 0) {
      setState(() => _error = 'Enter a valid amount.');
      return;
    }
    if (received < widget.amountDueMinor) {
      setState(() => _error = 'Cash received cannot be less than the amount due.');
      return;
    }
    Navigator.of(context).pop(CashCollectionResult(cashReceivedMinor: received));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: MediaQuery.of(context).viewInsets.bottom + 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Cash Collection', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text('Amount due: ${(widget.amountDueMinor / 100).toStringAsFixed(2)}'),
          const SizedBox(height: 12),
          TextField(
            key: const Key('cash-received-input'),
            controller: _controller,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Cash received', border: OutlineInputBorder()),
            onChanged: (_) => setState(() {}),
          ),
          if (_changeMinor > 0)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Change to record: ${(_changeMinor / 100).toStringAsFixed(2)}',
                key: const Key('cash-change-amount'),
                style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.deepOrange),
              ),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  key: const Key('cash-cancel'),
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Cancel'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  key: const Key('cash-confirm'),
                  onPressed: _confirm,
                  child: const Text('Confirm'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
