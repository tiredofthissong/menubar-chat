// preload.cjs - the only bridge between the window and the app. The window gets these
// few functions and nothing else (no Node, no file access). CommonJS because Electron's
// sandboxed preload can't load ES modules.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('menubarChat', {
  init: () => ipcRenderer.invoke('init'),
  send: (project, text) => ipcRenderer.send('send', { project, text }),
  answer: (project, id, decision) => ipcRenderer.send('answer', { project, id, decision }),
  stop: (project) => ipcRenderer.send('stop', { project }),
  hide: () => ipcRenderer.send('hide'),
  fit: (height) => ipcRenderer.send('fit', height),
  activity: (a) => ipcRenderer.send('activity', a),
  copy: (text) => ipcRenderer.send('copy', text),
  saveResults: (text) => ipcRenderer.invoke('save-results', text),
  onEvent: (fn) => {
    const handler = (_e, ev) => fn(ev);
    ipcRenderer.on('event', handler);
    return () => ipcRenderer.off('event', handler);
  },
});
