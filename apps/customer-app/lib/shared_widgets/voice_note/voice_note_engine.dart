import 'dart:async';
import 'dart:io';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

import '../../features/auth/presentation/auth_gate.dart';
import '../../features/hatly_service/data/hatly_service_api.dart';

/// Voice notes (owner decision 2026-11-27): the longest a note may be when the server does not say (Admin → Settings sets it).
const Duration voiceNoteMaxDuration = Duration(minutes: 5);

/// The limit from Admin → Settings (VOICE_NOTE_MAX_SECONDS, 30–600 s); the 5-minute default until it is known or when it cannot be read.
final voiceNoteLimitProvider = FutureProvider.autoDispose<Duration>((ref) async {
  if (!ref.watch(isSignedInProvider)) return voiceNoteMaxDuration;
  final s = await ref.watch(hatlyServiceApiProvider).getVoiceNoteMaxSeconds();
  return s != null && s >= 30 && s <= 600 ? Duration(seconds: s) : voiceNoteMaxDuration;
});

/// The device side of a voice note — recording and playback — behind one small interface so the screens can be tested without a microphone.
abstract class VoiceNoteEngine {
  /// Asks for the microphone when needed. False = the customer refused (or the device has none).
  Future<bool> ensurePermission();

  /// Starts recording to a new temporary file.
  Future<void> startRecording();

  /// Stops and returns the recorded file's path (null if nothing was recorded).
  Future<String?> stopRecording();

  /// Stops and throws the recording away.
  Future<void> cancelRecording();

  /// Plays a local file or an https URL; completes when playback STARTS. [onDone] runs when it ends.
  Future<void> play(String pathOrUrl, {required void Function() onDone});
  Future<void> stopPlayback();

  Future<List<int>> readBytes(String path);
  Future<void> dispose();
}

class DeviceVoiceNoteEngine implements VoiceNoteEngine {
  final AudioRecorder _recorder = AudioRecorder();
  final AudioPlayer _player = AudioPlayer();
  StreamSubscription<void>? _done;

  @override
  Future<bool> ensurePermission() => _recorder.hasPermission();

  @override
  Future<void> startRecording() async {
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/hatly-voice-${DateTime.now().millisecondsSinceEpoch}.m4a';
    // AAC in an M4A file, mono, 32 kbps: 5 minutes ≈ 1.2 MB — clear speech, light on mobile data (the server takes up to 4 MB).
    await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 32000, sampleRate: 22050, numChannels: 1), path: path);
  }

  @override
  Future<String?> stopRecording() => _recorder.stop();

  @override
  Future<void> cancelRecording() => _recorder.cancel();

  @override
  Future<void> play(String pathOrUrl, {required void Function() onDone}) async {
    await _done?.cancel();
    _done = _player.onPlayerComplete.listen((_) => onDone());
    final source = pathOrUrl.startsWith('http') ? UrlSource(pathOrUrl) : DeviceFileSource(pathOrUrl);
    await _player.play(source);
  }

  @override
  Future<void> stopPlayback() => _player.stop();

  @override
  Future<List<int>> readBytes(String path) => File(path).readAsBytes();

  @override
  Future<void> dispose() async {
    await _done?.cancel();
    await _recorder.dispose();
    await _player.dispose();
  }
}

/// A fresh engine per screen (it owns a recorder and a player); tests override this.
final voiceNoteEngineProvider = Provider.autoDispose<VoiceNoteEngine>((ref) {
  final engine = DeviceVoiceNoteEngine();
  ref.onDispose(engine.dispose);
  return engine;
});

String formatVoiceDuration(Duration d) {
  final m = d.inMinutes.remainder(60).toString().padLeft(1, '0');
  final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
  return '$m:$s';
}
