'use strict';
// Batch provider: any OpenAI-compatible `/audio/transcriptions` endpoint
// (OpenAI, Groq, a local whisper.cpp or faster-whisper server). Audio is
// buffered while the key is held and uploaded as a WAV on release.

const { concatPcm, pcm16ToWav } = require('../audio/pcm');

class BatchSession {
  constructor({ apiKey, settings, dictionary, log }) {
    this.apiKey = apiKey;
    this.settings = settings;
    this.dictionary = dictionary || [];
    this.log = log;
    this.chunks = [];
    this.aborted = false;
  }

  sendPcm(buf) {
    this.chunks.push(buf);
  }

  async finish() {
    if (this.aborted) return { text: '', raw: null };
    const wav = pcm16ToWav(concatPcm(this.chunks), 16000, 1);
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'dictation.wav');
    form.append('model', this.settings.model || 'whisper-1');
    form.append('response_format', 'json');
    if (this.settings.language) form.append('language', this.settings.language);
    if (this.dictionary.length) {
      // Whisper-style models bias towards words in the prompt.
      form.append('prompt', this.dictionary.slice(0, 60).join(', '));
    }
    const base = (this.settings.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const headers = {};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(this.settings.timeoutMs || 30000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Transcription HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    return { text: (data.text || '').trim(), raw: data };
  }

  abort() {
    this.aborted = true;
    this.chunks = [];
  }
}

function createSession(opts) {
  return new BatchSession(opts);
}

module.exports = { createSession, streaming: false, envKey: 'OPENAI_API_KEY' };
// Note: `local` reuses this module; its settings carry no key and the Bearer header is omitted.
