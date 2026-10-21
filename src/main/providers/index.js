'use strict';
// Speech-to-text provider registry.
//
// A provider exposes `createSession(opts)` and returns a session with:
//   sendPcm(buffer)          16 kHz mono PCM16, called ~every 100 ms
//   finish(): Promise<{text, raw}>   called on key release
//   abort()                  discard everything
// opts: { onPartial(text), dictionary: string[], language, log }

const deepgram = require('./deepgram');
const openai = require('./openai');
const fake = require('./fake');

// `local` is the OpenAI-compatible batch client pointed at a server on this machine.
const PROVIDERS = { local: openai, deepgram, openai, fake };

function getProvider(config) {
  const sttCfg = config.get().stt;
  const name = process.env.FLOW_CLONE_SMOKE ? 'fake' : sttCfg.provider;
  const impl = PROVIDERS[name];
  if (!impl) throw new Error(`Unknown STT provider: ${name}`);
  return { name, impl, settings: sttCfg[name] ?? {} };
}

module.exports = { getProvider, PROVIDERS };
