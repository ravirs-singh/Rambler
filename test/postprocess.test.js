'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { localFormat, fitToContext, applyDictionary, applySpokenCommands } = require('../src/main/text/postprocess');

test('spoken punctuation and layout commands', () => {
  assert.equal(applySpokenCommands('hello comma world period new line done question mark'),
    'hello, world.\ndone?');
  assert.equal(applySpokenCommands('first new paragraph second'), 'first\n\nsecond');
});

test('localFormat removes fillers, capitalizes, adds final period', () => {
  const out = localFormat('um so i think, like, we should ship it tomorrow');
  assert.equal(out, 'So i think, we should ship it tomorrow.');
});

test('localFormat keeps short fragments unpunctuated', () => {
  assert.equal(localFormat('ok thanks'), 'Ok thanks');
});

test('dictionary enforces casing and applies replacements', () => {
  const dict = [{ word: 'gRPC' }, { from: 'whisper flow', to: 'Wispr Flow' }];
  assert.equal(applyDictionary('we use grpc in whisper flow', dict), 'we use gRPC in Wispr Flow');
});

test('fitToContext adds spacing and capitalization based on the caret', () => {
  assert.equal(fitToContext('next sentence', { beforeText: 'First one.', afterText: '' }), ' Next sentence');
  assert.equal(fitToContext('world', { beforeText: 'hello', afterText: '' }), ' world');
  assert.equal(fitToContext('hello', { beforeText: '', afterText: 'there' }), 'hello ');
  assert.equal(fitToContext(', right', { beforeText: 'yes', afterText: '' }), ', right');
  assert.equal(fitToContext('x', { beforeText: 'line\n', afterText: '' }), 'x');
});
