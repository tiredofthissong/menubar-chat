// main.mjs - the Electron side of the proving kit: menu bar icon, window, hotkey,
// notifications, and one Claude Code session per test project.
// Pop-up pattern from the Maccy + menubar research: the window is built once, kept hidden,
// and only shown or hidden, so it opens fast.
import { app, globalShortcut, ipcMain, Notification, nativeImage, systemPreferences, clipboard, shell, screen } from 'electron';
import menubarPkg from 'menubar';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ProjectSession } from '../engine/session.mjs';
import { StatusBoard } from '../engine/status.mjs';
import { Budget } from '../engine/budget.mjs';
import { KEYCHAIN_SERVICE } from '../engine/options.mjs';
import { redact } from '../engine/redact.mjs';
import { Animator } from './animator.mjs';

const { menubar } = menubarPkg;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SCRATCH = process.env.MENUBAR_SCRATCH || path.join(app.getPath('home'), 'menubar-scratch');
const HOTKEY = 'Control+Alt+Command+C';
const CAP_USD = 5;
const TUCK_AFTER_MS = 5000;
const WIDTH = 780; const MIN_HEIGHT = 560; // the window grows from here to fit, up to the bottom of the screen
const INDEX_URL = pathToFileURL(path.join(HERE, 'window', 'index.html')).href;

if (!app.requestSingleInstanceLock()) app.quit();

const status = new StatusBoard();
const budget = new Budget(CAP_USD);
const sessions = new Map();
let projects = [];
let mb = null; let animator = null; let openStartedAt = 0; let tuckTimer = null; let hotkeyOk = false;
let activity = { hovered: false, typing: false, pinned: false };

function loadProjects() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'projects.json'), 'utf8'));
    return list.filter((p) => typeof p.name === 'string' && typeof p.path === 'string' && fs.existsSync(p.path))
      .map((p) => ({ name: p.name, path: p.path, tag: p.tag === 'personal' ? 'personal' : 'work' })); // untagged counts as work
  } catch { return []; }
}

const keychainHasKey = () => new Promise((resolve) => {
  // Asks only whether the item exists; without -w the secret itself is never printed.
  execFile('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], (err) => resolve(!err));
});

const send = (ev) => mb?.window?.webContents.send('event', ev);
const pendingCards = () => [...sessions.values()].reduce((n, s) => n + s.broker.size, 0);

function onEvent(ev) {
  send(ev);
  if (ev.type === 'status' || ev.type === 'turn_done' || ev.type === 'error') {
    const top = status.top();
    mb?.tray.setToolTip(top.line);
    animator?.setState(top.state);
  }
  if (ev.type === 'approval' && !mb.window?.isVisible()) notifyApproval(ev);
  if (ev.type === 'turn_done') scheduleTuck();
}

function notifyApproval(ev) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: `Waiting on you · ${ev.project}`,
    body: redact(ev.card.plain || 'Claude wants to do something.').slice(0, 180),
    actions: [{ type: 'button', text: 'Review' }, { type: 'button', text: 'Deny' }],
    closeButtonText: 'Later',
  });
  n.on('click', () => mb.showWindow());
  n.on('action', (_e, index) => {
    if (index === 0) mb.showWindow();
    else sessions.get(ev.project)?.answer(ev.card.id, 'deny'); // only Deny from a notification; Allow needs the card
  });
  n.show();
  send({ type: 'notified', project: ev.project });
}

function scheduleTuck() {
  clearTimeout(tuckTimer);
  tuckTimer = setTimeout(() => {
    if (!mb.window?.isVisible() || activity.hovered || activity.typing || activity.pinned || pendingCards() > 0) return;
    mb.hideWindow();
  }, TUCK_AFTER_MS);
}

function sessionFor(name) {
  const project = projects.find((p) => p.name === name);
  if (!project) return null;
  if (!sessions.has(name)) {
    sessions.set(name, new ProjectSession({
      project, sdk: { query }, emit: onEvent, status, budget,
      settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: ['~/claude-hub'] },
    }));
  }
  return sessions.get(name);
}

function toggle(source) {
  if (mb.window?.isVisible()) { mb.hideWindow(); return; }
  openStartedAt = performance.now(); openSource = source;
  mb.showWindow();
}
let openSource = 'icon';

// Only our own window may call these.
const fromOurWindow = (e) => e.senderFrame?.url === INDEX_URL;

function wireIpc() {
  ipcMain.handle('init', async (e) => {
    if (!fromOurWindow(e)) return null;
    return {
      projects: projects.map(({ name, tag }) => ({ name, tag })),
      scratch: SCRATCH, keychainOk: await keychainHasKey(), hotkey: hotkeyOk ? 'Control+Option+Command+C' : null,
      capUsd: CAP_USD, reducedMotion: Animator.reducedMotion(systemPreferences),
      versions: { app: app.getVersion(), electron: process.versions.electron, os: `${process.platform} ${process.getSystemVersion?.() || ''}`.trim() },
    };
  });
  ipcMain.on('send', (e, { project, text }) => { if (fromOurWindow(e) && typeof text === 'string' && text.trim()) sessionFor(project)?.send(text.slice(0, 20000)); });
  ipcMain.on('answer', (e, { project, id, decision }) => { if (fromOurWindow(e)) sessionFor(project)?.answer(id, decision); });
  ipcMain.on('stop', (e, { project }) => { if (fromOurWindow(e)) sessionFor(project)?.stop(); });
  ipcMain.on('hide', (e) => { if (fromOurWindow(e)) mb.hideWindow(); });
  ipcMain.on('fit', (e, wanted) => {
    if (!fromOurWindow(e) || !mb?.window || !Number.isFinite(wanted)) return;
    const b = mb.window.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const room = area.y + area.height - b.y - 8; // never past the bottom of the screen (or the Dock)
    const height = Math.round(Math.max(MIN_HEIGHT, Math.min(wanted, room)));
    if (Math.abs(height - b.height) > 4) mb.window.setBounds({ x: b.x, y: b.y, width: WIDTH, height }, false);
  });
  ipcMain.on('activity', (e, a) => {
    if (!fromOurWindow(e)) return;
    activity = { hovered: !!a?.hovered, typing: !!a?.typing, pinned: !!a?.pinned };
  });
  ipcMain.on('copy', (e, text) => { if (fromOurWindow(e)) clipboard.writeText(redact(String(text)).slice(0, 20000)); });
  ipcMain.handle('save-results', (e, text) => {
    if (!fromOurWindow(e)) return null;
    const file = path.join(ROOT, 'proving-results.md'); // git-ignored
    fs.writeFileSync(file, redact(String(text)).slice(0, 50000));
    shell.showItemInFolder(file);
    return file;
  });
}

app.whenReady().then(() => {
  projects = loadProjects();
  // Before the window exists: menubar loads the page while it starts, and the page asks
  // for 'init' straight away.
  wireIpc();
  hotkeyOk = globalShortcut.register(HOTKEY, () => { if (mb) toggle('hotkey'); });
  const iconPath = path.join(HERE, 'icons', 'idleTemplate.png');
  mb = menubar({
    index: INDEX_URL,
    icon: nativeImage.createFromPath(iconPath),
    tooltip: 'Ready',
    preloadWindow: true,
    showDockIcon: false,
    windowPosition: 'trayCenter',
    browserWindow: {
      width: WIDTH, height: 600, resizable: false, show: false,
      webPreferences: { preload: path.join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    },
  });

  mb.on('ready', () => {
    animator = new Animator({ tray: mb.tray, dir: path.join(HERE, 'icons'), nativeImage, systemPreferences });
    mb.tray.on('mouse-down', () => { if (!mb.window?.isVisible()) { openStartedAt = performance.now(); openSource = 'icon'; } });
    mb.window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/(academy\.claude\.com|code\.claude\.com)\//.test(url)) shell.openExternal(url); // vetted learn-more hosts only
      return { action: 'deny' };
    });
    mb.window.webContents.on('will-navigate', (ev) => ev.preventDefault());
  });
  mb.on('after-show', () => {
    const ms = openStartedAt ? Math.round(performance.now() - openStartedAt) : null;
    openStartedAt = 0;
    send({ type: 'opened', ms, source: openSource });
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  for (const s of sessions.values()) s.close(); // anything waiting is denied
  animator?.stop();
});
