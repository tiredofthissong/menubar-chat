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
  history: (project) => command({ type: 'history', project }),
  resume: (project, sessionId) => command({ type: 'resume', project, sessionId }),
  newChat: (project) => command({ type: 'newChat', project }),
  warm: (project) => command({ type: 'warm', project }),
  wrapUp: (project) => command({ type: 'wrapUp', project }),
  // Learning: the log by course, and a learn-more link the app opens only if it's on the checked list.
  learnSummary: () => ipcRenderer.invoke('learn:summary'),
  openLearn: (url) => ipcRenderer.invoke('learn:open', url),
  // Project actions the app does itself. The folder comes from the Mac's own picker, never from here.
  pickFolder: () => ipcRenderer.invoke('projects:pick'),
  addFolder: (tag) => ipcRenderer.invoke('projects:add', tag),
  listGithub: () => ipcRenderer.invoke('projects:githubList'), // names only; the GitHub sign-in stays in the app
  addGithub: (repo) => ipcRenderer.invoke('projects:github', String(repo).slice(0, 300)),
  putAway: (project) => ipcRenderer.invoke('projects:putAway', project),
  bringBack: (project) => ipcRenderer.invoke('projects:bringBack', project),
  setTag: (project, tag) => ipcRenderer.invoke('projects:tag', project, tag),
  blockPushes: (project) => ipcRenderer.invoke('projects:block', project),
  checkup: (project) => ipcRenderer.invoke('checkup:run', String(project ?? '').slice(0, 200)), // read-only checks
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
