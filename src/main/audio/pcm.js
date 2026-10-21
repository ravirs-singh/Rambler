'use strict';
// PCM helpers: concatenation, WAV container, RMS level.

function concatPcm(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = Buffer.allocUnsafe(total);
  let off = 0;
  for (const c of chunks) {
    c.copy(out, off);
    off += c.length;
  }
  return out;
}

/** Wrap 16-bit little-endian mono PCM in a RIFF/WAVE container. */
function pcm16ToWav(pcm, sampleRate = 16000, channels = 1) {
  const bytesPerSample = 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);                       // PCM fmt chunk size
  header.writeUInt16LE(1, 20);                        // audio format 1 = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(16, 34);                       // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function durationMs(pcm, sampleRate = 16000) {
  return Math.round((pcm.length / 2 / sampleRate) * 1000);
}

function rmsLevel(pcm) {
  const n = pcm.length >> 1;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

module.exports = { concatPcm, pcm16ToWav, durationMs, rmsLevel };
