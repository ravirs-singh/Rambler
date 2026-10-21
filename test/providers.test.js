'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUrl, parseResult } = require('../src/main/providers/deepgram');
const { pcm16ToWav, concatPcm, durationMs, rmsLevel } = require('../src/main/audio/pcm');
const { buildPrompt } = require('../src/main/formatter/prompt');
const { deepMerge, DEFAULTS } = require('../src/main/config');

test('deepgram url carries linear16/16k and keyterms', () => {
  const u = new URL(buildUrl({ model: 'nova-3', language: 'en' }, ['Wispr', 'gRPC']));
  assert.equal(u.searchParams.get('encoding'), 'linear16');
  assert.equal(u.searchParams.get('sample_rate'), '16000');
  assert.equal(u.searchParams.get('interim_results'), 'true');
  assert.deepEqual(u.searchParams.getAll('keyterm'), ['Wispr', 'gRPC']);
});

test('deepgram result parsing', () => {
  assert.equal(parseResult({ type: 'Metadata' }), null);
  assert.deepEqual(parseResult({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'hi there' }] } }),
    { text: 'hi there', isFinal: true });
});

test('wav header is well formed', () => {
  const pcm = Buffer.alloc(3200); // 100 ms of silence at 16 kHz
  const wav = pcm16ToWav(pcm, 16000, 1);
  assert.equal(wav.length, 44 + 3200);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 3200);
  assert.equal(durationMs(pcm), 100);
});

test('concat and rms', () => {
  const a = Buffer.alloc(4); a.writeInt16LE(16384, 0); a.writeInt16LE(-16384, 2);
  const b = Buffer.alloc(2);
  const all = concatPcm([a, b]);
  assert.equal(all.length, 6);
  assert.ok(Math.abs(rmsLevel(a) - 0.5) < 1e-3);
  assert.equal(rmsLevel(Buffer.alloc(0)), 0);
});

test('formatter prompt includes context sections', () => {
  const p = buildPrompt('send it tomorrow', { appName: 'Mail', beforeText: 'Hi Sam,\n', afterText: '', dictionary: ['Sam'], style: 'formal' });
  assert.match(p, /^APP: Mail/m);
  assert.match(p, /^STYLE: formal/m);
  assert.match(p, /DICTIONARY: Sam/);
  assert.match(p, /BEFORE: <<<Hi Sam,\n>>>/);
  assert.match(p, /TRANSCRIPT: <<<send it tomorrow>>>/);
});

test('config deepMerge keeps defaults for missing keys', () => {
  const merged = deepMerge(DEFAULTS, { stt: { provider: 'openai', openai: { model: 'whisper-1' } } });
  assert.equal(merged.stt.provider, 'openai');
  assert.equal(merged.stt.openai.model, 'whisper-1');
  assert.equal(merged.stt.openai.baseUrl, DEFAULTS.stt.openai.baseUrl);
  assert.equal(merged.hotkey.holdThresholdMs, DEFAULTS.hotkey.holdThresholdMs);
});
