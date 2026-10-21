'use strict';
// Streaming provider: Deepgram realtime WebSocket. Audio packets are sent as
// they are captured, interim results stream back while the key is held, and
// the final transcript is assembled from `is_final` results after CloseStream.

const { EventEmitter } = require('node:events');

function buildUrl(settings, dictionary) {
  const u = new URL('wss://api.deepgram.com/v1/listen');
  u.searchParams.set('encoding', 'linear16');
  u.searchParams.set('sample_rate', '16000');
  u.searchParams.set('channels', '1');
  u.searchParams.set('model', settings.model || 'nova-3');
  if (settings.language) u.searchParams.set('language', settings.language);
  u.searchParams.set('smart_format', 'true');
  u.searchParams.set('interim_results', 'true');
  u.searchParams.set('punctuate', 'true');
  u.searchParams.set('endpointing', '300');
  for (const term of (dictionary || []).slice(0, 100)) {
    // nova-3 keyterm prompting; nova-2 uses `keywords`. Both are harmless if unknown.
    u.searchParams.append('keyterm', term);
  }
  return u.toString();
}

/** Pure parser for Deepgram "Results" messages. Returns {text, isFinal} or null. */
function parseResult(msg) {
  if (!msg || msg.type !== 'Results') return null;
  const alt = msg.channel?.alternatives?.[0];
  if (!alt) return null;
  return { text: alt.transcript || '', isFinal: !!msg.is_final };
}

class DeepgramSession extends EventEmitter {
  constructor({ apiKey, settings, dictionary, onPartial, log }) {
    super();
    this.log = log;
    this.onPartial = onPartial || (() => {});
    this.finals = [];
    this.interim = '';
    this.queue = [];
    this.closed = false;
    this.readyPromise = new Promise((resolve, reject) => {
      this.ws = new WebSocket(buildUrl(settings, dictionary), ['token', apiKey]);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        for (const b of this.queue) this.ws.send(b);
        this.queue = [];
        resolve();
      };
      this.ws.onerror = (ev) => reject(new Error(`Deepgram socket error: ${ev.message || 'unknown'}`));
      this.ws.onmessage = (ev) => this._onMessage(ev.data);
      this.ws.onclose = (ev) => {
        this.closed = true;
        this.emit('closed', ev.code);
      };
    });
    this.readyPromise.catch((e) => this.emit('error', e));
  }

  _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    } catch {
      return;
    }
    if (msg.type === 'Error') {
      this.emit('error', new Error(msg.description || msg.message || 'Deepgram error'));
      return;
    }
    const r = parseResult(msg);
    if (!r) return;
    if (r.isFinal) {
      if (r.text) this.finals.push(r.text);
      this.interim = '';
    } else {
      this.interim = r.text;
    }
    this.onPartial(this.currentText());
  }

  currentText() {
    return [...this.finals, this.interim].filter(Boolean).join(' ');
  }

  sendPcm(buf) {
    if (this.closed) return;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(buf);
    else this.queue.push(buf);
  }

  async finish() {
    await this.readyPromise;
    if (this.closed) return { text: this.currentText(), raw: this.finals };
    this.ws.send(JSON.stringify({ type: 'Finalize' }));
    this.ws.send(JSON.stringify({ type: 'CloseStream' }));
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 4000);
      this.once('closed', () => { clearTimeout(t); resolve(); });
    });
    return { text: this.currentText(), raw: this.finals };
  }

  abort() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

function createSession(opts) {
  const apiKey = opts.apiKey;
  if (!apiKey) throw new Error('Deepgram API key missing (set stt.deepgram.apiKey or DEEPGRAM_API_KEY)');
  return new DeepgramSession(opts);
}

module.exports = { createSession, buildUrl, parseResult, streaming: true, envKey: 'DEEPGRAM_API_KEY' };
