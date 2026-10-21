'use strict';
// Settings store: a JSON file in the user-data directory, merged over defaults.
// Secrets (API keys) can come from environment variables so they never have to
// be written to disk.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  enabled: true,
  hotkey: {
    key: process.platform === 'darwin' ? 'RightAlt' : 'RightCtrl',
    holdThresholdMs: 220,       // press shorter than this is a "tap"
    doubleTapWindowMs: 400,     // two taps within this window toggle hands-free
    cancelKey: 'Escape',
  },
  audio: {
    sampleRate: 16000,
    chunkMs: 100,
    keepMicWarm: true,          // keep the mic stream open between dictations
    minDictationMs: 300,        // discard shorter takes (accidental presses)
  },
  stt: {
    provider: 'local',          // local | deepgram | openai | fake
    local: {
      // A whisper.cpp / faster-whisper server on this machine. No key, no cost.
      // See README "Free setup".
      baseUrl: 'http://127.0.0.1:8080/v1',
      model: 'whisper-1',
      language: 'en',
      timeoutMs: 60000,
    },
    deepgram: {
      apiKey: '',               // or DEEPGRAM_API_KEY
      model: 'nova-3',
      language: 'en',
    },
    openai: {
      apiKey: '',               // or OPENAI_API_KEY; any OpenAI-compatible server works
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-transcribe',
      language: '',
    },
  },
  formatter: {
    provider: 'none',           // none (free, local rules) | anthropic
    anthropic: {
      apiKey: '',               // or ANTHROPIC_API_KEY / `ant auth login`
      model: 'claude-opus-5-5',
      effort: 'low',
      timeoutMs: 8000,
    },
    style: 'auto',              // auto | casual | formal
    removeFillers: true,
    minWordsForLlm: 1,
  },
  insert: {
    method: 'paste',            // paste | type | clipboard (write only, no chord)
    restoreClipboardMs: 700,
    verify: true,
  },
  overlay: {
    enabled: true,
    sounds: true,
    position: 'bottom',         // bottom | top
  },
  context: {
    enabled: true,
    timeoutMs: 350,
    maxCharsEachSide: 600,
  },
});

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

class Config {
  constructor(file) {
    this.file = file;
    this.data = deepMerge(DEFAULTS, this.read());
    this.listeners = new Set();
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  get() {
    return this.data;
  }

  /** Merge a partial object into the config and persist it. */
  update(patch) {
    this.data = deepMerge(this.data, patch);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    for (const fn of this.listeners) fn(this.data);
    return this.data;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Resolve a secret from config or the environment. */
  secret(configValue, envName) {
    return (configValue && String(configValue).trim()) || process.env[envName] || '';
  }
}

module.exports = { Config, DEFAULTS, deepMerge };
