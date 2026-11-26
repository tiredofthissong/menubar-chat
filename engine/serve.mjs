// serve.mjs - the background process's side of Electron's built-in messaging.
// Electron starts engine/helper-process.mjs as a utility process; this file answers its parent
// port. There is no network port, no socket and no file to connect to: only the app that
// started this process can talk to it.
//
// Messages (plain objects, structured-cloned by Electron):
//   app -> helper: { kind: 'boot', projects, settings, capUsd, spendFile }   once, first
//                  { kind: 'command', id, cmd }                               cmd is checked in contract.mjs
//                  { kind: 'projects', projects }                           the list changed
//                  { kind: 'shutdown' }
//   helper -> app: { kind: 'ready', spentUsd } | { kind: 'event', ev } | { kind: 'reply', id, result }
import fs from 'node:fs';
import path from 'node:path';
import { Budget } from '../usage/budget.mjs';
import { createLogger } from '../shared/log.mjs';
import { createHelper } from './helper.mjs';

/** The spend file: { day, spent, chats } (an older file holds only day and spent). */
export function fileStore(file) {
  return {
    load: () => JSON.parse(fs.readFileSync(file, 'utf8')),
    save: (v) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ day: v.day, spent: v.spent, chats: v.chats || {} })); },
  };
}

/**
 * @param {{ on(type: 'message', fn: (e: { data: any }) => void): void, postMessage(msg: any): void }} port
 * @param {{ sdk: { query: Function, listSessions?: Function }, spawn?: Function, log?: object, exit?: () => void }} deps
 */
export function serveHelper(port, { sdk, spawn = null, log = createLogger(), exit = () => {} }) {
  let helper = null;
  const post = (msg) => { try { port.postMessage(msg); } catch (e) { log.warn('serve', 'post failed', { error: e }); } };

  port.on('message', async (e) => {
    const msg = e?.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'boot' && !helper) {
      const budget = new Budget(Number(msg.capUsd) || 5, { store: msg.spendFile ? fileStore(msg.spendFile) : null });
      const settings = { ...(msg.settings || {}), ...(spawn ? { spawn } : {}) };
      helper = createHelper({ projects: Array.isArray(msg.projects) ? msg.projects : [], sdk, budget, settings, log,
        send: (ev) => post({ kind: 'event', ev }) });
      post({ kind: 'ready', spentUsd: budget.spent });
      return;
    }
    if (msg.kind === 'command') {
      const result = helper ? await helper.handleCommand(msg.cmd) : { ok: false, error: 'The background helper is still starting.' };
      post({ kind: 'reply', id: msg.id, result });
      return;
    }
    if (msg.kind === 'projects') { helper?.setProjects(msg.projects); return; }
    if (msg.kind === 'shutdown') { helper?.shutdown(); exit(); }
  });
  return { get helper() { return helper; } };
}
