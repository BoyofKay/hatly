import { UploadRejectedError } from './image-validation';

/** Voice notes (owner decision 2026-11-27): up to 5 minutes. At the apps' 32–64 kbps that is ≤ 2.4 MB; 4 MB leaves room. */
export const MAX_UPLOAD_AUDIO_BYTES = 4 * 1024 * 1024;

export interface DetectedAudio {
  mime: 'audio/mp4' | 'audio/aac' | 'audio/mpeg' | 'audio/ogg' | 'audio/wav' | 'audio/webm';
  extension: '.m4a' | '.aac' | '.mp3' | '.ogg' | '.wav' | '.webm';
}

/** The audio type from the bytes themselves (never from the file name the client sends). */
export function detectAudioType(b: Buffer): DetectedAudio | null {
  if (b.length < 12) return null;
  if (b.toString('latin1', 4, 8) === 'ftyp') return { mime: 'audio/mp4', extension: '.m4a' }; // MP4 / M4A (AAC)
  if (b.toString('latin1', 0, 4) === 'OggS') return { mime: 'audio/ogg', extension: '.ogg' };
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') return { mime: 'audio/wav', extension: '.wav' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'audio/webm', extension: '.webm' };
  if (b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe6) === 0xe2)) return { mime: 'audio/mpeg', extension: '.mp3' };
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { mime: 'audio/aac', extension: '.aac' }; // ADTS AAC
  return null;
}

export function decodeBase64Audio(base64Content: string): { base64: string; audio: DetectedAudio } {
  const clean = (base64Content ?? '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!clean) throw new UploadRejectedError('UPLOAD_EMPTY', 'The voice note is empty.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new UploadRejectedError('UPLOAD_NOT_BASE64', 'The voice note is not valid base64.');
  const buffer = Buffer.from(clean, 'base64');
  if (buffer.length === 0) throw new UploadRejectedError('UPLOAD_EMPTY', 'The voice note is empty.');
  if (buffer.length > MAX_UPLOAD_AUDIO_BYTES) throw new UploadRejectedError('UPLOAD_TOO_LARGE', 'The voice note is too long (up to 5 minutes).');
  const audio = detectAudioType(buffer);
  if (!audio) throw new UploadRejectedError('UNSUPPORTED_AUDIO_TYPE', 'This is not a supported voice recording.');
  return { base64: clean, audio };
}
