'use strict';
// Trigger-key state machine, kept free of OS dependencies so it can be unit
// tested. `HotkeyController` wires it to uiohook-napi.
//
// Semantics (mirrors push-to-talk + double-tap-to-lock):
//   key down, held > holdThresholdMs ........ emit 'start' (push-to-talk)
//   key up after a push-to-talk start ........ emit 'stop'
//   tap, tap within doubleTapWindowMs ........ emit 'start' with locked=true
//   any press while locked ................... emit 'stop'
//   cancel key while active .................. emit 'cancel'

const { EventEmitter } = require('node:events');

class TriggerStateMachine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.holdThresholdMs = opts.holdThresholdMs ?? 220;
    this.doubleTapWindowMs = opts.doubleTapWindowMs ?? 400;
    this.now = opts.now ?? (() => Date.now());
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t));
    this.reset();
  }

  reset() {
    this.active = false;      // a dictation is in progress
    this.locked = false;      // hands-free (double tap) mode
    this.keyIsDown = false;
    this.downAt = 0;
    this.lastTapAt = 0;
    this.holdTimer = null;
  }

  keyDown() {
    if (this.keyIsDown) return; // auto-repeat
    this.keyIsDown = true;
    this.downAt = this.now();

    if (this.active && this.locked) {
      // Any press while locked ends the dictation.
      this._stop('lock-release');
      this.lastTapAt = 0;
      return;
    }
    if (this.active) return;

    this.holdTimer = this.setTimer(() => {
      this.holdTimer = null;
      if (this.keyIsDown && !this.active) this._start(false);
    }, this.holdThresholdMs);
  }

  keyUp() {
    if (!this.keyIsDown) return;
    this.keyIsDown = false;
    const heldFor = this.now() - this.downAt;

    if (this.holdTimer) {
      this.clearTimer(this.holdTimer);
      this.holdTimer = null;
    }

    if (this.active && !this.locked) {
      this._stop('release');
      return;
    }

    if (!this.active && heldFor < this.holdThresholdMs) {
      const t = this.now();
      if (t - this.lastTapAt <= this.doubleTapWindowMs && this.lastTapAt !== 0) {
        this.lastTapAt = 0;
        this._start(true);
      } else {
        this.lastTapAt = t;
      }
    }
  }

  cancel() {
    if (!this.active) return false;
    this.active = false;
    this.locked = false;
    this.emit('cancel');
    return true;
  }

  /** Programmatic toggle (tray click, deep link). */
  toggle() {
    if (this.active) this._stop('toggle');
    else this._start(true);
  }

  _start(locked) {
    this.active = true;
    this.locked = locked;
    this.emit('start', { locked });
  }

  _stop(reason) {
    this.active = false;
    this.locked = false;
    this.emit('stop', { reason });
  }
}

// Human-readable key names → uiohook keycodes. Resolved lazily so this module
// loads without the native addon (tests, CI).
function resolveKeycode(name) {
  const { UiohookKey } = require('uiohook-napi');
  const aliases = {
    RightAlt: 'AltRight', LeftAlt: 'Alt', RightCtrl: 'CtrlRight', LeftCtrl: 'Ctrl',
    RightShift: 'ShiftRight', LeftShift: 'Shift', RightCmd: 'MetaRight', LeftCmd: 'Meta',
    RightOption: 'AltRight', LeftOption: 'Alt', Option: 'Alt', Cmd: 'Meta',
  };
  const key = aliases[name] ?? name;
  const code = UiohookKey[key];
  if (code === undefined) throw new Error(`Unknown hotkey name: ${name}`);
  return code;
}

class HotkeyController {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.machine = null;
    this.started = false;
  }

  start() {
    const cfg = this.config.get().hotkey;
    const { uIOhook } = require('uiohook-napi');
    this.machine = new TriggerStateMachine(cfg);
    this.keycode = resolveKeycode(cfg.key);
    this.cancelCode = resolveKeycode(cfg.cancelKey);

    this.onDown = (e) => {
      if (e.keycode === this.keycode) this.machine.keyDown();
      else if (e.keycode === this.cancelCode) this.machine.cancel();
    };
    this.onUp = (e) => {
      if (e.keycode === this.keycode) this.machine.keyUp();
    };
    uIOhook.on('keydown', this.onDown);
    uIOhook.on('keyup', this.onUp);
    uIOhook.start();
    this.started = true;
    this.log.info(`hotkey listening on ${cfg.key} (code ${this.keycode})`);
    return this.machine;
  }

  stop() {
    if (!this.started) return;
    const { uIOhook } = require('uiohook-napi');
    uIOhook.off('keydown', this.onDown);
    uIOhook.off('keyup', this.onUp);
    uIOhook.stop();
    this.started = false;
  }
}

module.exports = { TriggerStateMachine, HotkeyController, resolveKeycode };
