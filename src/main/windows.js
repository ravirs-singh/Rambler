'use strict';
// The three renderer surfaces: hidden mic capture window, overlay pill, settings.

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('node:path');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload');

function createCaptureBridge(config, log) {
  const win = new BrowserWindow({
    show: false,
    width: 200,
    height: 100,
    webPreferences: {
      preload: path.join(PRELOAD, 'capture.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(RENDERER, 'capture.html'));
  const chunkListeners = new Set();
  const ready = new Promise((resolve) => ipcMain.once('capture:ready', resolve));

  ipcMain.on('capture:chunk', (_e, arrayBuffer) => {
    const buf = Buffer.from(arrayBuffer);
    for (const fn of chunkListeners) fn(buf);
  });
  ipcMain.on('capture:log', (_e, level, msg) => log[level]?.(`[capture] ${msg}`));

  const call = async (channel, payload) => {
    await ready;
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      ipcMain.once(`capture:reply:${id}`, (_e, err, result) => (err ? reject(new Error(err)) : resolve(result)));
      win.webContents.send(channel, { id, ...payload });
    });
  };

  return {
    window: win,
    onChunk: (fn) => chunkListeners.add(fn),
    start: () => call('capture:start', { ...config.get().audio }),
    stop: () => call('capture:stop', {}),
    close: () => call('capture:close', {}),
  };
}

function createOverlay(config) {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 420;
  const height = 92;
  const pos = config.get().overlay.position;
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: pos === 'top' ? workArea.y + 12 : workArea.y + workArea.height - height - 12,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,          // never steal focus from the app being dictated into
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload: path.join(PRELOAD, 'overlay.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(RENDERER, 'overlay.html'));

  let hideTimer = null;
  const send = (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };
  return {
    window: win,
    show() {
      clearTimeout(hideTimer);
      if (!win.isVisible()) win.showInactive();
    },
    hideSoon(ms = 1200) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { if (!win.isDestroyed()) win.hide(); }, ms);
    },
    state(s) { send('overlay:state', s); },
    partial(t) { send('overlay:partial', t); },
    level(l) { send('overlay:level', l); },
  };
}

let settingsWin = null;
function openSettings(config, history) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return settingsWin;
  }
  settingsWin = new BrowserWindow({
    width: 720,
    height: 760,
    title: 'Rambler settings',
    webPreferences: {
      preload: path.join(PRELOAD, 'settings.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  settingsWin.loadFile(path.join(RENDERER, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
  return settingsWin;
}

module.exports = { createCaptureBridge, createOverlay, openSettings };
