import { decodeBase64Audio, detectAudioType, MAX_UPLOAD_AUDIO_BYTES } from './audio-validation';

const withHead = (head: number[] | string, size = 64) => {
  const b = Buffer.alloc(size);
  (typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head)).copy(b);
  return b;
};

describe('voice note validation', () => {
  it('detects common voice formats by their bytes', () => {
    const m4a = Buffer.alloc(64); Buffer.from('ftypM4A ', 'latin1').copy(m4a, 4);
    expect(detectAudioType(m4a)?.extension).toBe('.m4a');
    expect(detectAudioType(withHead('OggS'))?.extension).toBe('.ogg');
    expect(detectAudioType(withHead([0xff, 0xf1, 0x50, 0x80]))?.extension).toBe('.aac');
    expect(detectAudioType(withHead('ID3'))?.extension).toBe('.mp3');
    expect(detectAudioType(withHead([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // a PNG is not audio
  });

  it('refuses empty, non-base64, too large and non-audio', () => {
    expect(() => decodeBase64Audio('')).toThrow();
    expect(() => decodeBase64Audio('@@@')).toThrow();
    expect(() => decodeBase64Audio(Buffer.alloc(64).toString('base64'))).toThrow(/supported/);
    const big = Buffer.alloc(MAX_UPLOAD_AUDIO_BYTES + 10); Buffer.from('OggS', 'latin1').copy(big);
    expect(() => decodeBase64Audio(big.toString('base64'))).toThrow(/too long/);
    expect(decodeBase64Audio(withHead('OggS').toString('base64')).audio.mime).toBe('audio/ogg');
  });
});
