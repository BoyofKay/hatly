import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';

import '../core/localization/bilingual.dart';

/// The playback the widget needs — a thin seam over audioplayers so the screen can be tested without a device.
abstract class VoiceNotePlayback {
  Future<void> play(String url, {required void Function() onDone});
  Future<void> stop();
  Future<void> dispose();
}

class _AudioPlayersPlayback implements VoiceNotePlayback {
  final AudioPlayer _player = AudioPlayer();
  StreamSubscription<void>? _done;

  @override
  Future<void> play(String url, {required void Function() onDone}) async {
    await _done?.cancel();
    _done = _player.onPlayerComplete.listen((_) => onDone());
    await _player.play(UrlSource(url));
  }

  @override
  Future<void> stop() => _player.stop();

  @override
  Future<void> dispose() async {
    await _done?.cancel();
    await _player.dispose();
  }
}

/// Plays the customer's voice note on a Hatly / Wasaly request (owner decision 2026-11-27).
class VoiceNotePlayer extends StatefulWidget {
  const VoiceNotePlayer({super.key, required this.url, this.player});
  final String url;

  /// Test hook; the real audio player otherwise.
  final VoiceNotePlayback? player;

  @override
  State<VoiceNotePlayer> createState() => _VoiceNotePlayerState();
}

class _VoiceNotePlayerState extends State<VoiceNotePlayer> {
  VoiceNotePlayback? _playback;
  bool _playing = false;
  bool _failed = false;

  VoiceNotePlayback get _p => _playback ??= widget.player ?? _AudioPlayersPlayback();

  @override
  void dispose() {
    final p = _playback;
    if (p != null && widget.player == null) unawaited(p.dispose());
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_playing) {
      await _p.stop();
      if (mounted) setState(() => _playing = false);
      return;
    }
    setState(() {
      _playing = true;
      _failed = false;
    });
    try {
      await _p.play(widget.url, onDone: () {
        if (mounted) setState(() => _playing = false);
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _playing = false;
          _failed = true;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, children: [
      OutlinedButton.icon(
        key: const Key('voice-note-play'),
        onPressed: _toggle,
        icon: Icon(_playing ? Icons.stop_circle_outlined : Icons.play_circle_outline),
        label: Text(_playing ? context.t('Stop', 'إيقاف') : context.t("Play the customer's voice note", 'تشغيل رسالة العميل الصوتية')),
      ),
      if (_failed) Text(context.t('Could not play', 'تعذّر التشغيل'), style: const TextStyle(color: Colors.red, fontSize: 12)),
    ]);
  }
}
