'use strict';
// Focused-field context: app identity plus the text before/after the caret.
// Uses a small native helper when available (helper/macos/ax-context built
// with `npm run build:helper:mac`, helper/windows/ax-context.ps1), and falls
// back to app-name-only lookups. Every call is time-boxed so dictation never
// waits on it.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HELPER_DIR = path.join(__dirname, '..', '..', '..', 'helper');

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      (err, stdout) => resolve(err ? null : stdout));
    child.on('error', () => resolve(null));
  });
}

function parseJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

async function macContext(timeoutMs) {
  const bin = path.join(HELPER_DIR, 'macos', 'ax-context');
  if (fs.existsSync(bin)) {
    const out = await run(bin, [], timeoutMs);
    const j = out && parseJson(out);
    if (j) return j;
  }
  const out = await run('osascript', ['-e',
    'tell application "System Events" to get {name, bundle identifier} of first application process whose frontmost is true'], timeoutMs);
  if (!out) return {};
  const [appName, bundleId] = out.trim().split(', ');
  return { appName, bundleId, helper: false };
}

async function windowsContext(timeoutMs) {
  const script = path.join(HELPER_DIR, 'windows', 'ax-context.ps1');
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], timeoutMs);
  return (out && parseJson(out)) || {};
}

async function linuxContext(timeoutMs) {
  const name = await run('xdotool', ['getactivewindow', 'getwindowname'], timeoutMs);
  return name ? { appName: name.trim(), helper: false } : {};
}

/**
 * Returns {appName, bundleId, windowTitle, isEditable, beforeText, selectedText, afterText, helper}
 * with every field optional. Never throws.
 */
async function getContext(cfg, log) {
  if (!cfg.enabled) return {};
  const t0 = Date.now();
  let ctx = {};
  try {
    if (process.platform === 'darwin') ctx = await macContext(cfg.timeoutMs);
    else if (process.platform === 'win32') ctx = await windowsContext(cfg.timeoutMs);
    else ctx = await linuxContext(cfg.timeoutMs);
  } catch (e) {
    log.warn(`context lookup failed: ${e.message}`);
  }
  const n = cfg.maxCharsEachSide ?? 600;
  if (ctx.beforeText && ctx.beforeText.length > n) ctx.beforeText = ctx.beforeText.slice(-n);
  if (ctx.afterText && ctx.afterText.length > n) ctx.afterText = ctx.afterText.slice(0, n);
  ctx.lookupMs = Date.now() - t0;
  return ctx;
}

/** Second helper call after insertion: did the text land in the field? */
async function readFieldText(cfg, log) {
  const ctx = await getContext({ ...cfg, maxCharsEachSide: 4000 }, log);
  return ctx.beforeText == null && ctx.afterText == null ? null : `${ctx.beforeText || ''}${ctx.afterText || ''}`;
}

module.exports = { getContext, readFieldText };
