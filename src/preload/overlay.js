'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onState: (fn) => ipcRenderer.on('overlay:state', (_e, s) => fn(s)),
  onPartial: (fn) => ipcRenderer.on('overlay:partial', (_e, t) => fn(t)),
  onLevel: (fn) => ipcRenderer.on('overlay:level', (_e, l) => fn(l)),
});
