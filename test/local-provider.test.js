'use strict';
// The `local` provider is the OpenAI-compatible batch client without a key.
// Stand up a tiny HTTP server that behaves like whisper.cpp's server and check
// the multipart upload shape and the parsed result.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createSession } = require('../src/main/providers/openai');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('local whisper server receives a WAV upload and returns text', async () => {
  let seen = null;
  const { server, port } = await startServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen = { url: req.url, auth: req.headers.authorization, contentType: req.headers['content-type'], body };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ text: ' hello from whisper ' }));
    });
  });
  try {
    const session = createSession({
      apiKey: null,
      settings: { baseUrl: `http://127.0.0.1:${port}/v1`, model: 'whisper-1', language: 'en' },
      dictionary: ['Rambler'],
      log: { info() {}, warn() {} },
    });
    session.sendPcm(Buffer.alloc(3200));
    session.sendPcm(Buffer.alloc(3200));
    const result = await session.finish();
    assert.equal(result.text, 'hello from whisper');
    assert.equal(seen.url, '/v1/audio/transcriptions');
    assert.equal(seen.auth, undefined, 'no Authorization header without a key');
    assert.match(seen.contentType, /^multipart\/form-data; boundary=/);
    const text = seen.body.toString('latin1');
    assert.match(text, /name="file"; filename="dictation.wav"/);
    assert.match(text, /name="model"\r\n\r\nwhisper-1/);
    assert.match(text, /name="language"\r\n\r\nen/);
    assert.match(text, /name="prompt"\r\n\r\nRambler/);
    assert.ok(text.includes('RIFF'), 'WAV header present');
    assert.ok(seen.body.length > 44 + 6400);
  } finally {
    server.close();
  }
});

test('non-2xx responses surface as errors', async () => {
  const { server, port } = await startServer((_req, res) => { res.statusCode = 500; res.end('boom'); });
  try {
    const session = createSession({ apiKey: null, settings: { baseUrl: `http://127.0.0.1:${port}/v1` }, log: { warn() {} } });
    session.sendPcm(Buffer.alloc(320));
    await assert.rejects(() => session.finish(), /HTTP 500: boom/);
  } finally {
    server.close();
  }
});
