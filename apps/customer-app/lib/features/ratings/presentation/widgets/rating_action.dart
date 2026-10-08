import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../data/rating_api.dart';
import 'star_rating_input.dart';

/// Customer Ratings. Generic enough for both Vendor and Product
/// targets (Section 15/16 — each rendered independently, never
/// collapsed) — the caller supplies the label and the submit
/// callback; this widget has no opinion on which backend endpoint is
/// called. Quiet and non-intrusive: a single compact row, no forced
/// popup, matching Section 11's explicit requirement.
class RatingAction extends StatefulWidget {
  const RatingAction({
    super.key,
    required this.label,
    required this.alreadyRated,
    required this.existingRating,
    required this.onSubmit,
  });

  final String label;
  final bool alreadyRated;
  final SubmittedRating? existingRating;

  /// Throws on failure — the caller (bottom sheet) surfaces the error;
  /// this widget itself never talks to the network directly.
  final Future<void> Function(int stars, String? comment) onSubmit;

  @override
  State<RatingAction> createState() => _RatingActionState();
}

class _RatingActionState extends State<RatingAction> {
  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    if (widget.alreadyRated && widget.existingRating != null) {
      // READ-ONLY — CONFIRMED, no edit/delete/second-submit affordance
      // anywhere here, matching the backend's immutable design.
      return Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.ratingYourRatingLabel,
                      style: const TextStyle(
                          fontSize: 12, color: HatlyColors.textMuted)),
                  const SizedBox(height: 2),
                  StarRatingDisplay(value: widget.existingRating!.stars),
                  if (widget.existingRating!.comment != null &&
                      widget.existingRating!.comment!.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(widget.existingRating!.comment!,
                        style: const TextStyle(fontSize: 13)),
                  ],
                ],
              ),
            ),
          ],
        ),
      );
    }

    return Align(
      alignment: Alignment.centerLeft,
      child: TextButton.icon(
        icon: const Icon(Icons.star_border, size: 18),
        label: Text(l10n.ratingRateAction),
        onPressed: () => _openRatingSheet(context),
      ),
    );
  }

  Future<void> _openRatingSheet(BuildContext context) async {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheetContext) =>
          _RatingSheet(label: widget.label, onSubmit: widget.onSubmit),
    );
  }
}

class _RatingSheet extends StatefulWidget {
  const _RatingSheet({required this.label, required this.onSubmit});
  final String label;
  final Future<void> Function(int stars, String? comment) onSubmit;

  @override
  State<_RatingSheet> createState() => _RatingSheetState();
}

class _RatingSheetState extends State<_RatingSheet> {
  int _stars = 0;
  final _commentController = TextEditingController();
  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    if (_stars == 0) {
      setState(() => _errorMessage = l10n.ratingSelectStarsPrompt);
      return;
    }
    if (_isSubmitting) return; // prevents obvious double-tap submission
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });
    try {
      await widget.onSubmit(
          _stars,
          _commentController.text.trim().isEmpty
              ? null
              : _commentController.text.trim());
      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(l10n.ratingSubmittedSuccess)));
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _errorMessage = l10n.somethingWentWrong;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return Padding(
      padding: EdgeInsets.fromLTRB(
          20, 20, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.label,
              style:
                  const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          Center(
              child: StarRatingInput(
                  value: _stars, onChanged: (v) => setState(() => _stars = v))),
          const SizedBox(height: 16),
          TextField(
            controller: _commentController,
            maxLines: 3,
            decoration: InputDecoration(
              hintText: l10n.ratingCommentHint,
              border:
                  OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            ),
          ),
          if (_errorMessage != null) ...[
            const SizedBox(height: 8),
            // Audit F-D5: fixed `Colors.red` — identical to the old
            // constant in Light Mode.
            Text(_errorMessage!, style: TextStyle(color: p.urgent, fontSize: 13)),
          ],
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _isSubmitting ? null : _submit,
              child: _isSubmitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(l10n.ratingSubmitButton),
            ),
          ),
        ],
      ),
    );
  }
}
