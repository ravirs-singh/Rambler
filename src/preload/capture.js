'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flow', {
  ready: () => ipcRenderer.send('capture:ready'),
  sendChunk: (arrayBuffer) => ipcRenderer.send('capture:chunk', arrayBuffer),
  log: (level, msg) => ipcRenderer.send('capture:log', level, msg),
  onCommand: (channel, handler) => {
    ipcRenderer.on(channel, async (_e, payload) => {
      try {
        const result = await handler(payload);
        ipcRenderer.send(`capture:reply:${payload.id}`, null, result ?? null);
      } catch (e) {
        ipcRenderer.send(`capture:reply:${payload.id}`, e?.message || String(e), null);
      }
    });
  },
});
