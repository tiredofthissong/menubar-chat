// main.mjs - the Electron side: menu bar icon, window, hotkey and notifications.
// Claude Code runs in a background process (engine/helper-process.mjs), reached only through Electron's messaging (app/helper-link.mjs).
// Pop-up pattern from the Maccy + menubar research: the window is built once, kept hidden, and only shown or hidden, so it opens fast.
import { app, dialog, globalShortcut, ipcMain, Menu, Notification, nativeImage, systemPreferences, clipboard, shell, screen, utilityProcess } from 'electron';
import menubarPkg from 'menubar';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { KEYCHAIN_SERVICE, DEFAULT_MODEL } from '../engine/options.mjs';
import { validateCommand } from '../shared/contract.mjs';
import { redact } from '../shared/redact.mjs';
import { createHelperLink } from './helper-link.mjs';
import { Animator } from './animator.mjs';
import { TuckTimer } from './tuck.mjs';
import { approvalNotice } from './notify.mjs';
import { createProjects } from './project-ipc.mjs';
import { createLearning } from './learning.mjs';
import { isLearnLink } from '../shared/learn.mjs';
import { createHandoffOpener } from './handoff-open.mjs';
import { createLoginItem, trayMenuTemplate, withCommonPaths } from './login-item.mjs';

const { menubar } = menubarPkg;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SCRATCH = process.env.MENUBAR_SCRATCH || path.join(app.getPath('home'), 'menubar-scratch');
const HOTKEY = 'Control+Alt+Command+C';
const CAP_USD = 5; // per day, across all projects (Bromo's pick, Nov 26)
const WIDTH = 480; const MIN_HEIGHT = 480; // the window grows from here to fit, up to the bottom of the screen
const INDEX_URL = pathToFileURL(path.join(HERE, 'window', 'index.html')).href;

// The same folder for your projects, spend and learning log whether it runs from the Terminal or installed.
app.setPath('userData', path.join(app.getPath('appData'), 'menubar-chat'));
if (!app.requestSingleInstanceLock()) app.quit();
const login = createLoginItem({ app });

let projects = null; let learning = null; let spentUsd = 0; let pendingCards = 0; let busy = 0;
let mb = null; let animator = null; let openStartedAt = 0; let hotkeyOk = false; let activity = { hovered: false, typing: false };
const notices = new Map(); // card id -> its notification, closed once the card is answered
const tuck = new TuckTimer({
  hide: () => mb?.hideWindow(),
  state: () => ({ visible: !!mb?.window?.isVisible(), ...activity, pendingCards, busy }),
});

const keychainHasKey = () => new Promise((resolve) => {
  // Asks only whether the item exists; without -w the secret itself is never printed.
  execFile('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], (err) => resolve(!err));
});

const send = (ev) => mb?.window?.webContents.send('event', ev);
const handoff = createHandoffOpener({ shell, send });

// The helper's environment leaves out any API key in the app's own environment; each Claude Code
// process gets its key from the Keychain only (engine/options.mjs).
const helperEnv = () => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^ANTHROPIC_|^CLAUDE_CODE_/.test(k))),
  PATH: withCommonPaths(process.env.PATH, app.getPath('home')), // opened from the Finder, PATH is short
});
const link = createHelperLink({
  fork: (entry) => utilityProcess.fork(entry, [], { serviceName: 'Menu bar chat helper', env: helperEnv() }),
  entry: path.join(ROOT, 'engine', 'helper-process.mjs'),
  boot: () => ({
    projects: projects.list, capUsd: CAP_USD, spendFile: path.join(app.getPath('userData'), 'spend-today.json'),
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: ['~/claude-hub'], model: DEFAULT_MODEL },
  }),
  onReady: (m) => { spentUsd = m.spentUsd ?? spentUsd; },
  onEvent,
  onExit: () => {
    pendingCards = 0; busy = 0; animator?.setState('error'); mb?.tray.setToolTip('Needs a look: the background helper stopped');
    for (const p of projects.list) send({ type: 'error', project: p.name, code: 'helper-lost', text: 'The background helper stopped, so nothing was approved. Send your message again to restart it.' });
  },
});

function onEvent(ev) {
  if (!ev || typeof ev !== 'object') return;
  if (ev.type === 'status') {
    pendingCards = ev.pendingCards || 0; busy = ev.busy || 0;
    mb?.tray.setToolTip(ev.line); animator?.setState(ev.state);
    tuck.changed();
    return;
  }
  if (typeof ev.spentUsd === 'number') spentUsd = ev.spentUsd;
  send(ev);
  if (ev.type === 'approval') { if (!ev.card?.regrouped) learning?.record(ev); if (!mb.window?.isVisible()) notifyApproval(ev); }
  if (ev.type === 'approval_closed') { notices.get(ev.id)?.close(); notices.delete(ev.id); }
  handoff(ev); // a big job: Claude's desktop app opens with it
  if (ev.type === 'turn_done') tuck.replied();
}

function notifyApproval(ev) {
  if (!Notification.isSupported()) return;
  const n = new Notification(approvalNotice(ev)); // Review and Deny only
  notices.set(ev.card.id, n);
  n.on('close', () => notices.delete(ev.card.id));
  n.on('click', () => mb.showWindow());
  n.on('action', (_e, index) => {
    if (index === 0) mb.showWindow();
    else link.command({ type: 'answer', project: ev.project, id: ev.card.id, decision: 'deny' }); // only Deny from a notification; Allow needs the card
  });
  n.show();
  send({ type: 'notified', project: ev.project });
}

function toggle(source) {
  if (mb.window?.isVisible()) { mb.hideWindow(); return; }
  openStartedAt = performance.now(); openSource = source;
  mb.showWindow();
}
let openSource = 'icon';

const APP_VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch { return app.getVersion(); } })();  // shown in Usage, so a test can tell which build runs

// Only our own window may call these.
const fromOurWindow = (e) => e.senderFrame?.url === INDEX_URL;

function wireIpc() {
  ipcMain.handle('init', async (e) => {
    if (!fromOurWindow(e)) return null;
    await Promise.race([link.start(), new Promise((r) => setTimeout(r, 3000))]); // today's spend comes from the helper
    return {
      projects: projects.view(),
      scratch: SCRATCH, keychainOk: await keychainHasKey(), hotkey: hotkeyOk ? 'Control+Option+Command+C' : null,
      capUsd: CAP_USD, spentUsd, model: 'Sonnet', reducedMotion: Animator.reducedMotion(systemPreferences),
      versions: { app: APP_VERSION, electron: process.versions.electron, os: `${process.platform} ${process.getSystemVersion?.() || ''}`.trim() },
    };
  });
  // Chat commands: checked here, then again in the helper, before anything acts on them.
  ipcMain.handle('command', async (e, raw) => {
    if (!fromOurWindow(e)) return { ok: false, error: 'not from this window' };
    const v = validateCommand(raw);
    return v.ok ? link.command(v.cmd) : { ok: false, error: v.error };
  });
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
    activity = { hovered: !!a?.hovered, typing: !!a?.typing };
    tuck.changed();
  });
  ipcMain.on('copy', (e, text) => { if (fromOurWindow(e)) clipboard.writeText(redact(String(text)).slice(0, 20000)); });
}

app.whenReady().then(() => {
  projects = createProjects({
    ipcMain, dialog, window: () => mb?.window, fromOurWindow, home: app.getPath('home'), trash: (p) => shell.trashItem(p),
    userFile: path.join(app.getPath('userData'), 'projects.json'), scratchFile: path.join(SCRATCH, 'projects.json'),
    onChange: (list) => link.projects(list),
  });
  learning = createLearning({ ipcMain, shell, fromOurWindow, file: path.join(app.getPath('userData'), 'learning-log.jsonl') });
  // Before the window exists: menubar loads the page while it starts, and the page asks
  // for 'init' straight away.
  wireIpc();
  link.start(); // warm: the helper is ready before the first message
  hotkeyOk = globalShortcut.register(HOTKEY, () => { if (mb) toggle('hotkey'); });
  mb = menubar({
    index: INDEX_URL,
    icon: nativeImage.createFromPath(path.join(HERE, 'icons', 'idleTemplate.png')),
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
    // Reduce Motion turned on or off while the app runs: the icon follows at once.
    systemPreferences.subscribeWorkspaceNotification?.('NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification', () => animator.refresh());
    mb.tray.on('mouse-down', () => { if (!mb.window?.isVisible()) { openStartedAt = performance.now(); openSource = 'icon'; } });
    mb.tray.on('right-click', () => mb.tray.popUpContextMenu(Menu.buildFromTemplate(trayMenuTemplate({ login, quit: () => app.quit() }))));
    mb.window.webContents.setWindowOpenHandler(({ url }) => {
      if (isLearnLink(url)) shell.openExternal(url); // the checked learn-more list only
      return { action: 'deny' };
    });
    mb.window.webContents.on('will-navigate', (ev) => ev.preventDefault());
  });
  mb.on('after-hide', () => tuck.cancel());
  mb.on('after-show', () => {
    tuck.cancel(); // an old reply never tucks a fresh window
    const ms = openStartedAt ? Math.round(performance.now() - openStartedAt) : null;
    openStartedAt = 0;
    send({ type: 'opened', ms, source: openSource });
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  link.stop(); // every session closes and anything waiting is denied
  animator?.stop();
});
