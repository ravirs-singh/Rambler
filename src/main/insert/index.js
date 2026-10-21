'use strict';
// Text insertion: write to the clipboard, send the paste chord to the focused
// app, then restore what was on the clipboard. Modes:
//   paste      clipboard + Cmd/Ctrl+V + restore (default)
//   type       synthetic keystrokes (slower; for apps that block paste)
//   clipboard  write only, no chord, no restore (manual paste / headless tests)

const { execFile } = require('node:child_process');

function exec(cmd, args, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

async function sendPasteChord() {
  switch (process.platform) {
    case 'darwin':
      return exec('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    case 'win32':
      return exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '$w = New-Object -ComObject WScript.Shell; $w.SendKeys("^v")']);
    default:
      try {
        return await exec('xdotool', ['key', '--clearmodifiers', 'ctrl+v']);
      } catch {
        return exec('ydotool', ['key', '29:1', '47:1', '47:0', '29:0']);
      }
  }
}

async function typeText(text) {
  switch (process.platform) {
    case 'darwin': {
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return exec('osascript', ['-e', `tell application "System Events" to keystroke "${escaped}"`], 30000);
    }
    case 'win32': {
      const escaped = text.replace(/([+^%~(){}[\]])/g, '{$1}').replace(/'/g, "''");
      return exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$w = New-Object -ComObject WScript.Shell; $w.SendKeys('${escaped}')`], 30000);
    }
    default:
      return exec('xdotool', ['type', '--clearmodifiers', '--delay', '2', text], 30000);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Insert `text` into the focused app. Returns {method, ms}.
 * `deps.clip` is the clipboard adapter from ./clipboard.js.
 */
async function insertText(text, cfg, deps, log) {
  const t0 = Date.now();
  const { clip } = deps;
  if (!text) return { method: 'none', ms: 0 };

  if (cfg.method === 'type') {
    await typeText(text);
    return { method: 'type', ms: Date.now() - t0 };
  }

  if (cfg.method === 'clipboard') {
    await clip.writeText(text);
    return { method: 'clipboard', ms: Date.now() - t0 };
  }

  const snap = await clip.snapshot();
  await clip.writeText(text);
  // Give the clipboard owner change time to propagate before the chord lands.
  await sleep(30);
  let method = 'paste';
  try {
    await sendPasteChord();
  } catch (e) {
    log.warn(`paste chord failed, typing instead: ${e.message}`);
    await typeText(text);
    method = 'type-fallback';
  }
  // Restore after the target app has had time to read the clipboard.
  setTimeout(async () => {
    try {
      if ((await clip.readText()) === text) await clip.restore(snap);
    } catch (e) {
      log.warn(`clipboard restore failed: ${e.message}`);
    }
  }, cfg.restoreClipboardMs ?? 700);
  return { method, ms: Date.now() - t0 };
}

module.exports = { insertText, sendPasteChord, typeText };
