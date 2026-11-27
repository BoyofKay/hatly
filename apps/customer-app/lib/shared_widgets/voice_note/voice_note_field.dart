import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/localization/l10n/app_localizations.dart';
import '../../core/theme/hatly_theme.dart';
import 'voice_note_engine.dart';

/// A recorded voice note, still on the device (uploaded when the request is submitted).
class VoiceNoteDraft {
  const VoiceNoteDraft({required this.path, required this.duration});
  final String path;
  final Duration duration;
}

/// Record (up to 5 minutes, stops by itself at the limit), listen, delete. Optional — text, photos and voice are each optional.
class VoiceNoteField extends ConsumerStatefulWidget {
  const VoiceNoteField({super.key, required this.value, required this.onChanged, this.maxDuration});

  final VoiceNoteDraft? value;
  final ValueChanged<VoiceNoteDraft?> onChanged;
  /// Fixed limit (tests); null = the limit set in Admin → Settings.
  final Duration? maxDuration;

  @override
  ConsumerState<VoiceNoteField> createState() => _VoiceNoteFieldState();
}

class _VoiceNoteFieldState extends ConsumerState<VoiceNoteField> {
  bool _recording = false;
  bool _playing = false;
  bool _busy = false;
  String? _error;
  Duration _elapsed = Duration.zero;
  Timer? _timer;

  VoiceNoteEngine get _engine => ref.read(voiceNoteEngineProvider);

  Duration get _max => widget.maxDuration ?? ref.read(voiceNoteLimitProvider).valueOrNull ?? voiceNoteMaxDuration;

  @override
  void initState() {
    super.initState();
    // Keep the engine alive for as long as this field is on screen.
    ref.listenManual(voiceNoteEngineProvider, (_, __) {});
  }

  @override
  void dispose() {
    _timer?.cancel();
    if (_recording) unawaited(_engine.cancelRecording());
    super.dispose();
  }

  Future<void> _start() async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (!await _engine.ensurePermission()) {
        if (mounted) setState(() => _error = l10n.voiceNotePermissionDenied);
        return;
      }
      await _engine.startRecording();
      if (!mounted) return;
      setState(() {
        _recording = true;
        _elapsed = Duration.zero;
      });
      _timer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted) return;
        setState(() => _elapsed += const Duration(seconds: 1));
        if (_elapsed >= _max) unawaited(_stop());
      });
    } catch (_) {
      if (mounted) setState(() => _error = l10n.voiceNoteFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _stop() async {
    if (!_recording) return;
    _timer?.cancel();
    final l10n = AppLocalizations.of(context);
    setState(() => _recording = false);
    try {
      final path = await _engine.stopRecording();
      if (!mounted) return;
      if (path == null || _elapsed < const Duration(seconds: 1)) {
        setState(() => _error = l10n.voiceNoteTooShort);
        return;
      }
      widget.onChanged(VoiceNoteDraft(path: path, duration: _elapsed > _max ? _max : _elapsed));
    } catch (_) {
      if (mounted) setState(() => _error = l10n.voiceNoteFailed);
    }
  }

  Future<void> _togglePlay(VoiceNoteDraft note) async {
    if (_playing) {
      await _engine.stopPlayback();
      if (mounted) setState(() => _playing = false);
      return;
    }
    setState(() => _playing = true);
    try {
      await _engine.play(note.path, onDone: () => mounted ? setState(() => _playing = false) : null);
    } catch (_) {
      if (mounted) setState(() => _playing = false);
    }
  }

  Future<void> _delete() async {
    if (_playing) await _engine.stopPlayback();
    if (mounted) setState(() => _playing = false);
    widget.onChanged(null);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    ref.watch(voiceNoteLimitProvider);
    final note = widget.value;
    Widget body;
    if (_recording) {
      body = Row(children: [
        Icon(Icons.fiber_manual_record, color: p.urgent, size: 18),
        const SizedBox(width: HatlySpacing.sm),
        Expanded(
          child: Text('${l10n.voiceNoteRecording} ${formatVoiceDuration(_elapsed)} / ${formatVoiceDuration(_max)}',
              key: const Key('voice-note-elapsed'), style: context.type.small),
        ),
        FilledButton.icon(
          key: const Key('voice-note-stop'),
          onPressed: _stop,
          icon: const Icon(Icons.stop),
          label: Text(l10n.voiceNoteStop),
        ),
      ]);
    } else if (note != null) {
      body = Row(children: [
        IconButton(
          key: const Key('voice-note-play'),
          tooltip: _playing ? l10n.voiceNoteStopPlaying : l10n.voiceNotePlay,
          onPressed: () => _togglePlay(note),
          icon: Icon(_playing ? Icons.stop_circle_outlined : Icons.play_circle_outline, size: 32),
        ),
        Expanded(child: Text('${l10n.voiceNoteAttached} · ${formatVoiceDuration(note.duration)}', key: const Key('voice-note-attached'), style: context.type.small)),
        IconButton(
          key: const Key('voice-note-delete'),
          tooltip: l10n.voiceNoteDelete,
          onPressed: _delete,
          icon: Icon(Icons.delete_outline, color: p.urgent),
        ),
      ]);
    } else {
      body = Align(
        alignment: AlignmentDirectional.centerStart,
        child: OutlinedButton.icon(
          key: const Key('voice-note-record'),
          onPressed: _busy ? null : _start,
          icon: const Icon(Icons.mic_none),
          label: Text(l10n.voiceNoteRecord),
        ),
      );
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      body,
      const SizedBox(height: HatlySpacing.xs),
      Text(l10n.voiceNoteLimitHint(formatVoiceDuration(_max)), style: context.type.caption),
      if (_error != null) ...[
        const SizedBox(height: HatlySpacing.xs),
        Text(_error!, key: const Key('voice-note-error'), style: context.type.small.copyWith(color: p.urgent)),
      ],
    ]);
  }
}

/// Plays a voice note that is already on the server (cart / order details).
class VoiceNotePlayButton extends ConsumerStatefulWidget {
  const VoiceNotePlayButton({super.key, required this.url});
  final String url;

  @override
  ConsumerState<VoiceNotePlayButton> createState() => _VoiceNotePlayButtonState();
}

class _VoiceNotePlayButtonState extends ConsumerState<VoiceNotePlayButton> {
  bool _playing = false;

  @override
  void initState() {
    super.initState();
    ref.listenManual(voiceNoteEngineProvider, (_, __) {});
  }

  Future<void> _toggle() async {
    final engine = ref.read(voiceNoteEngineProvider);
    if (_playing) {
      await engine.stopPlayback();
      if (mounted) setState(() => _playing = false);
      return;
    }
    setState(() => _playing = true);
    try {
      await engine.play(widget.url, onDone: () => mounted ? setState(() => _playing = false) : null);
    } catch (_) {
      if (mounted) setState(() => _playing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return TextButton.icon(
      key: const Key('voice-note-play-remote'),
      onPressed: _toggle,
      icon: Icon(_playing ? Icons.stop_circle_outlined : Icons.play_circle_outline),
      label: Text(_playing ? l10n.voiceNoteStopPlaying : l10n.voiceNotePlay),
    );
  }
}
