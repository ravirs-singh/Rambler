'use strict';
// Offline provider for smoke tests: counts audio and returns a fixed sentence.

const { concatPcm, durationMs } = require('../audio/pcm');

class FakeSession {
  constructor({ onPartial, settings }) {
    this.onPartial = onPartial || (() => {});
    this.chunks = [];
    this.text = settings?.text || 'hello world this is a test of the flow clone period';
    this.partialTimer = setInterval(() => this.onPartial(this.text.slice(0, this.chunks.length * 3)), 150);
  }

  sendPcm(buf) {
    this.chunks.push(buf);
  }

  async finish() {
    clearInterval(this.partialTimer);
    const pcm = concatPcm(this.chunks);
    return { text: this.text, raw: { audioMs: durationMs(pcm), bytes: pcm.length, chunks: this.chunks.length } };
  }

  abort() {
    clearInterval(this.partialTimer);
  }
}

module.exports = { createSession: (o) => new FakeSession(o), streaming: true, envKey: null };
