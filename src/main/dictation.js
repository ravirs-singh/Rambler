'use strict';
// The dictation pipeline, one take at a time:
//   start:  capture mic → provider session, read field context in parallel
//   chunk:  PCM → provider (+ level meter to the overlay)
//   stop:   finish provider → local format → LLM format → insert → verify → history
// Each step is timed and recorded so latency regressions are visible.

const { EventEmitter } = require('node:events');
const { getProvider } = require('./providers');
const { getContext, readFieldText } = require('./context');
const { localFormat, fitToContext } = require('./text/postprocess');
const formatter = require('./formatter');
const { insertText } = require('./insert');
const { rmsLevel } = require('./audio/pcm');

let seq = 0;

class Dictation extends EventEmitter {
  /**
   * deps: { config, capture, history, clip, log }
   *   capture: { start(), stop(), onChunk(fn) } – the hidden mic window bridge
   */
  constructor(deps) {
    super();
    Object.assign(this, deps);
    this.take = null;
    this.capture.onChunk((buf) => this._onChunk(buf));
  }

  get busy() {
    return !!this.take;
  }

  async start({ locked } = {}) {
    if (this.take) return;
    const cfg = this.config.get();
    if (!cfg.enabled) return;
    const take = {
      id: `${Date.now().toString(36)}-${++seq}`,
      locked: !!locked,
      t: { start: Date.now() },
      chunks: 0,
      audioMs: 0,
      partial: '',
      cancelled: false,
    };
    this.take = take;
    this.emit('state', { state: 'listening', take: take.id, locked: take.locked });

    const dictionary = this.history.dictionaryWords();
    take.dictionary = dictionary;
    take.contextPromise = getContext(cfg.context, this.log).then((c) => { take.context = c; take.t.context = Date.now(); return c; });

    try {
      const { name, impl, settings } = getProvider(this.config);
      take.providerName = name;
      take.session = impl.createSession({
        apiKey: impl.envKey && name !== 'local' ? this.config.secret(settings.apiKey, impl.envKey) : null,
        settings,
        dictionary,
        log: this.log,
        onPartial: (text) => {
          if (this.take !== take) return;
          take.partial = text;
          this.emit('partial', { take: take.id, text });
        },
      });
      take.session.on?.('error', (e) => this.log.warn(`provider error: ${e.message}`));
    } catch (e) {
      this.log.error(`cannot start provider: ${e.message}`);
      this.emit('state', { state: 'error', message: e.message });
      this.take = null;
      return;
    }
    await this.capture.start();
    take.t.capturing = Date.now();
  }

  _onChunk(buf) {
    const take = this.take;
    if (!take || !take.session || take.finishing) return;
    take.chunks++;
    take.audioMs += (buf.length / 2 / this.config.get().audio.sampleRate) * 1000;
    take.session.sendPcm(buf);
    if (take.chunks % 2 === 0) this.emit('level', rmsLevel(buf));
  }

  async cancel() {
    const take = this.take;
    if (!take) return;
    take.cancelled = true;
    this.take = null;
    await this.capture.stop();
    take.session?.abort();
    this.emit('state', { state: 'idle', reason: 'cancelled' });
    this.history.append({ id: take.id, outcome: 'cancelled', audioMs: Math.round(take.audioMs) });
  }

  async stop({ reason } = {}) {
    const take = this.take;
    if (!take || take.finishing) return;
    take.finishing = true;
    const cfg = this.config.get();
    take.t.release = Date.now();
    await this.capture.stop();

    if (take.audioMs < cfg.audio.minDictationMs) {
      take.session.abort();
      this.take = null;
      this.emit('state', { state: 'idle', reason: 'too-short' });
      return;
    }

    this.emit('state', { state: 'transcribing', take: take.id });
    let transcript = '';
    let raw = null;
    try {
      ({ text: transcript, raw } = await take.session.finish());
    } catch (e) {
      this.log.error(`transcription failed: ${e.message}`);
      this.emit('state', { state: 'error', message: `Transcription failed: ${e.message}` });
      this.take = null;
      this.history.append({ id: take.id, outcome: 'stt-error', error: e.message, audioMs: Math.round(take.audioMs) });
      return;
    }
    take.t.transcript = Date.now();

    if (!transcript.trim()) {
      this.take = null;
      this.emit('state', { state: 'idle', reason: 'empty' });
      this.history.append({ id: take.id, outcome: 'empty', audioMs: Math.round(take.audioMs), provider: take.providerName });
      return;
    }

    const context = (await take.contextPromise) || {};
    const dictionary = this.history.getDictionary();
    const local = localFormat(transcript, { dictionary, removeFillers: cfg.formatter.removeFillers });

    this.emit('state', { state: 'formatting', take: take.id, text: local });
    const llm = await formatter.format(transcript, { ...context, dictionary: take.dictionary },
      cfg.formatter, (v, env) => this.config.secret(v, env), this.log);
    take.t.format = Date.now();
    const chosen = llm != null && llm !== '' ? llm : local;
    const finalText = fitToContext(chosen, context);

    this.emit('state', { state: 'inserting', take: take.id, text: finalText });
    let insertion = { method: 'skipped' };
    try {
      insertion = await insertText(finalText, cfg.insert, { clip: this.clip }, this.log);
    } catch (e) {
      this.log.error(`insertion failed: ${e.message}`);
      this.emit('state', { state: 'error', message: `Could not insert text: ${e.message}` });
    }
    take.t.insert = Date.now();

    let verified = null;
    if (cfg.insert.verify && context.helper) {
      await new Promise((r) => setTimeout(r, 150));
      const field = await readFieldText(cfg.context, this.log);
      if (field != null) verified = field.includes(chosen.trim().slice(0, 40));
    }

    this.take = null;
    this.emit('state', { state: 'done', take: take.id, text: finalText, verified });
    const entry = {
      id: take.id,
      outcome: 'inserted',
      provider: take.providerName,
      formatter: llm != null ? cfg.formatter.provider : 'local',
      app: context.appName || null,
      words: finalText.trim().split(/\s+/).length,
      audioMs: Math.round(take.audioMs),
      transcript,
      text: finalText,
      verified,
      insertMethod: insertion.method,
      latencyMs: {
        toCapture: take.t.capturing - take.t.start,
        context: take.t.context ? take.t.context - take.t.start : null,
        transcript: take.t.transcript - take.t.release,
        format: take.t.format - take.t.transcript,
        insert: take.t.insert - take.t.format,
        total: take.t.insert - take.t.release,
      },
      rawProvider: raw && typeof raw === 'object' && !Array.isArray(raw) ? { audioMs: raw.audioMs, chunks: raw.chunks } : undefined,
    };
    this.history.append(entry);
    return entry;
  }
}

module.exports = { Dictation };
