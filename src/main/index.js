'use strict';
// Electron main process: wires hotkey → dictation pipeline → overlay/tray.

const electron = require('electron');
const { app, Tray, Menu, nativeImage, ipcMain, shell } = electron;
const { createClipboardAdapter } = require('./insert/clipboard');
const path = require('node:path');
const { Config } = require('./config');
const { createLog } = require('./log');
const { History } = require('./history');
const { HotkeyController } = require('./hotkey');
const { Dictation } = require('./dictation');
const { createCaptureBridge, createOverlay, openSettings } = require('./windows');

const SMOKE = !!process.env.FLOW_CLONE_SMOKE;

if (process.platform === 'darwin') app.dock?.hide();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let tray;
let hotkey;
let dictation;
let overlay;

function trayIcon() {
  // 16x16 circle drawn as a data URL so no asset pipeline is needed.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect x="11" y="3" width="10" height="17" rx="5" fill="#111"/>
    <path d="M7 15a9 9 0 0 0 18 0" fill="none" stroke="#111" stroke-width="3"/>
    <rect x="14.5" y="24" width="3" height="5" fill="#111"/></svg>`;
  const img = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  const icon = img.resize({ width: 16, height: 16 });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}

function buildTrayMenu(config, history) {
  const cfg = config.get();
  const stats = history.stats();
  return Menu.buildFromTemplate([
    { label: `Flow Clone  ·  ${stats.words} words, ${stats.dictations} takes`, enabled: false },
    { type: 'separator' },
    { label: 'Enabled', type: 'checkbox', checked: cfg.enabled, click: (m) => config.update({ enabled: m.checked }) },
    { label: `Hotkey: hold ${cfg.hotkey.key}, double-tap to lock`, enabled: false },
    { label: 'Start / stop dictation', click: () => hotkey.machine?.toggle() },
    { type: 'separator' },
    {
      label: 'Speech provider',
      submenu: ['local', 'deepgram', 'openai'].map((p) => ({
        label: p, type: 'radio', checked: cfg.stt.provider === p, click: () => config.update({ stt: { provider: p } }),
      })),
    },
    {
      label: 'Formatter',
      submenu: ['none', 'anthropic'].map((p) => ({
        label: p, type: 'radio', checked: cfg.formatter.provider === p, click: () => config.update({ formatter: { provider: p } }),
      })),
    },
    { type: 'separator' },
    { label: 'Settings…', click: () => openSettings(config, history) },
    { label: 'Open history file', click: () => shell.showItemInFolder(history.file) },
    { label: 'Open log', click: () => shell.openPath(global.log.file) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function registerSettingsIpc(config, history) {
  ipcMain.handle('settings:get', () => ({ config: config.get(), dictionary: history.getDictionary(), history: history.recent(30), stats: history.stats() }));
  ipcMain.handle('settings:set', (_e, patch) => config.update(patch));
  ipcMain.handle('dictionary:set', (_e, entries) => { history.setDictionary(entries); return entries; });
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  const log = createLog(path.join(userData, 'logs'));
  global.log = log;
  const config = new Config(path.join(userData, 'config.json'));
  const history = new History(userData);
  log.info(`starting flow-clone ${app.getVersion()} (${process.platform}) data=${userData}`);

  const capture = createCaptureBridge(config, log);
  overlay = createOverlay(config);
  const clip = createClipboardAdapter(electron);
  log.info(`clipboard api: ${clip.kind}`);
  if (SMOKE) config.data = { ...config.data, insert: { ...config.data.insert, method: 'clipboard' } };
  dictation = new Dictation({ config, capture, history, clip, log });
  registerSettingsIpc(config, history);

  dictation.on('state', (s) => {
    log.info(`state ${s.state}${s.reason ? ` (${s.reason})` : ''}${s.message ? `: ${s.message}` : ''}`);
    if (!config.get().overlay.enabled) return;
    overlay.state({ ...s, sounds: config.get().overlay.sounds });
    if (s.state === 'listening') overlay.show();
    if (s.state === 'done' || s.state === 'idle') overlay.hideSoon(s.state === 'done' ? 1400 : 300);
    if (s.state === 'error') { overlay.show(); overlay.hideSoon(3500); }
  });
  dictation.on('partial', (p) => overlay.partial(p.text));
  dictation.on('level', (l) => overlay.level(l));

  hotkey = new HotkeyController(config, log);
  try {
    const machine = hotkey.start();
    machine.on('start', (e) => dictation.start(e));
    machine.on('stop', (e) => dictation.stop(e));
    machine.on('cancel', () => dictation.cancel());
  } catch (e) {
    log.error(`global hotkey unavailable: ${e.message}. On macOS grant Accessibility + Input Monitoring to the app.`);
  }

  tray = new Tray(trayIcon());
  tray.setToolTip('Flow Clone');
  const refreshMenu = () => tray.setContextMenu(buildTrayMenu(config, history));
  refreshMenu();
  config.onChange(refreshMenu);
  dictation.on('state', (s) => { if (s.state === 'done') refreshMenu(); });
  tray.on('click', () => { if (process.platform !== 'darwin') hotkey.machine?.toggle(); });

  if (SMOKE) runSmoke(dictation, clip, log).catch((e) => { log.error(`smoke failed: ${e.stack}`); app.exit(2); });
});

/** Headless end-to-end check used by `npm run smoke` (fake mic + fake STT). */
async function runSmoke(dictation, clip, log) {
  const states = [];
  dictation.on('state', (s) => states.push(s.state));
  await dictation.start({ locked: false });
  await new Promise((r) => setTimeout(r, 1500));
  const entry = await dictation.stop({ reason: 'smoke' });
  const clipboardText = await clip.readText();
  const ok = !!entry && entry.outcome === 'inserted' && entry.audioMs > 500 && clipboardText === entry.text && !states.includes('error');
  const summary = { ok, states, audioMs: entry?.audioMs, chunks: entry?.rawProvider?.chunks, text: entry?.text, latencyMs: entry?.latencyMs, clipboardText };
  log.info(`SMOKE ${JSON.stringify(summary)}`);
  console.log(`SMOKE_RESULT ${JSON.stringify(summary)}`);
  setTimeout(() => app.exit(ok ? 0 : 1), 300);
}

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => { try { hotkey?.stop(); } catch { /* ignore */ } });
