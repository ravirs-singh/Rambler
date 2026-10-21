'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TriggerStateMachine } = require('../src/main/hotkey');

/** Deterministic clock + timer queue. */
function harness() {
  let now = 0;
  const timers = [];
  const m = new TriggerStateMachine({
    holdThresholdMs: 200,
    doubleTapWindowMs: 400,
    now: () => now,
    setTimer: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  const events = [];
  m.on('start', (e) => events.push(['start', e.locked]));
  m.on('stop', (e) => events.push(['stop', e.reason]));
  m.on('cancel', () => events.push(['cancel']));
  const advance = (ms) => {
    now += ms;
    for (const t of [...timers].sort((a, b) => a.at - b.at)) {
      if (t.at <= now) { timers.splice(timers.indexOf(t), 1); t.fn(); }
    }
  };
  return { m, events, advance };
}

test('hold past threshold = push-to-talk, release stops', () => {
  const { m, events, advance } = harness();
  m.keyDown();
  advance(100);
  assert.deepEqual(events, []);
  advance(150);
  assert.deepEqual(events, [['start', false]]);
  advance(1000);
  m.keyUp();
  assert.deepEqual(events, [['start', false], ['stop', 'release']]);
});

test('single tap does nothing', () => {
  const { m, events, advance } = harness();
  m.keyDown(); advance(50); m.keyUp(); advance(1000);
  assert.deepEqual(events, []);
});

test('double tap locks, next press stops', () => {
  const { m, events, advance } = harness();
  m.keyDown(); advance(50); m.keyUp();
  advance(150);
  m.keyDown(); advance(50); m.keyUp();
  assert.deepEqual(events, [['start', true]]);
  advance(3000);
  m.keyDown(); advance(50); m.keyUp();
  assert.deepEqual(events, [['start', true], ['stop', 'lock-release']]);
});

test('two taps too far apart do not lock', () => {
  const { m, events, advance } = harness();
  m.keyDown(); advance(50); m.keyUp();
  advance(600);
  m.keyDown(); advance(50); m.keyUp();
  assert.deepEqual(events, []);
});

test('auto-repeat keydown events are ignored', () => {
  const { m, events, advance } = harness();
  m.keyDown(); advance(50); m.keyDown(); advance(50); m.keyDown(); advance(150);
  assert.deepEqual(events, [['start', false]]);
});

test('cancel while active emits cancel and resets', () => {
  const { m, events, advance } = harness();
  m.keyDown(); advance(250);
  assert.equal(m.cancel(), true);
  m.keyUp();
  assert.deepEqual(events, [['start', false], ['cancel']]);
  assert.equal(m.active, false);
});

test('toggle starts locked and stops', () => {
  const { m, events } = harness();
  m.toggle(); m.toggle();
  assert.deepEqual(events, [['start', true], ['stop', 'toggle']]);
});
