// preload.cjs - the only bridge between the window and the app. The window gets these
// few functions and nothing else (no Node, no file access). CommonJS because Electron's
// sandboxed preload can't load ES modules. Every chat command is checked twice: by the app
// and again by the background helper (shared/contract.mjs).
const { contextBridge, ipcRenderer } = require('electron');

const command = (cmd) => ipcRenderer.invoke('command', cmd);

contextBridge.exposeInMainWorld('menubarChat', {
  init: () => ipcRenderer.invoke('init'),
  send: (project, text) => command({ type: 'send', project, text }),
  answer: (project, id, decision) => command({ type: 'answer', project, id, decision }),
  stop: (project) => command({ type: 'stop', project }),
  setMode: (project, mode) => command({ type: 'setMode', project, mode }),
  undo: (project, changeId) => command({ type: 'undo', project, changeId }),
  hide: () => ipcRenderer.send('hide'),
  fit: (height) => ipcRenderer.send('fit', height),
  activity: (a) => ipcRenderer.send('activity', a),
  copy: (text) => ipcRenderer.send('copy', text),
  onEvent: (fn) => {
    const handler = (_e, ev) => fn(ev);
    ipcRenderer.on('event', handler);
    return () => ipcRenderer.off('event', handler);
  },
});
