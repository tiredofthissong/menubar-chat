// helper.mjs - wires the projects' sessions together. No windows, no Electron: the background
// process (engine/serve.mjs) feeds it commands and passes its events on; tests call it directly.
//
// Every event leaves through ONE function, publish(): it redacts each string value, keeps a
// short replay list per project (for a window that reloads), and turns status changes into
// one hover line for the menu bar, sent only when it changes.
import { validateCommand, event } from '../shared/contract.mjs';
import { redactDeep } from '../shared/redact.mjs';
import { StatusBoard } from '../status/status.mjs';
import { listProjectSessions } from '../sidebar/sessions.mjs';
import { ProjectSession } from './session.mjs';

export const REPLAY = 300;
const SKIP_REPLAY = new Set(['status']);

/**
 * @param {{ projects: Array<{name, path, tag}>, sdk: { query: Function, listSessions?: Function },
 *   budget, settings: object, log, send: (ev: object) => void }} d
 */
export function createHelper({ projects, sdk, budget, settings, log, send }) {
  const status = new StatusBoard();
  const sessions = new Map(); const replay = new Map(); const byName = new Map(projects.map((p) => [p.name, p]));
  let last = '';

  const pendingCards = () => [...sessions.values()].reduce((n, s) => n + s.broker.size, 0);

  function publish(ev) {
    if (ev.type === 'status') {
      const top = status.top();
      const line = { ...top, pendingCards: pendingCards() };
      const key = JSON.stringify(line);
      if (key !== last) { last = key; send(redactDeep(event('status', line))); }
      return;
    }
    const safe = redactDeep(ev);
    if (safe.project && !SKIP_REPLAY.has(safe.type)) {
      const list = replay.get(safe.project) || []; list.push(safe);
      if (list.length > REPLAY) list.shift();
      replay.set(safe.project, list);
    }
    try { send(safe); } catch (e) { log.warn('helper', 'send failed', { error: e }); }
  }

  function sessionFor(name) {
    const project = byName.get(name);
    if (!project) return null;
    if (!sessions.has(name)) sessions.set(name, new ProjectSession({ project, sdk, emit: publish, status, budget, settings, log }));
    return sessions.get(name);
  }

  const actions = {
    send: (s, c) => { s.send(c.text); return { ok: true }; },
    answer: (s, c) => (s.answer(c.id, c.decision) ? { ok: true } : { ok: false, error: 'That card was already answered or has gone.' }),
    stop: async (s) => { await s.stop(); return { ok: true }; },
    setMode: async (s, c) => { const r = await s.setMode(c.mode); return r.ok ? { ok: true, mode: r.mode } : { ok: false, error: r.text }; },
    undo: (s, c) => { const r = s.undo(c.changeId); return { ok: r.ok, text: r.text }; },
    history: async (s) => (sdk.listSessions ? { ok: true, sessions: await listProjectSessions(s.project, sdk.listSessions) } : { ok: true, sessions: [] }),
    resume: (s, c) => { s.resume(c.sessionId); publish(event('session', { project: s.project.name, sessionId: c.sessionId, mode: s.mode })); return { ok: true }; },
    newChat: (s) => { s.resume(null); return { ok: true }; },
    replay: (s) => ({ ok: true, events: replay.get(s.project.name) || [] }),
  };

  /** One command from the window. Never throws; always answers in plain words. */
  async function handleCommand(raw) {
    const v = validateCommand(raw);
    if (!v.ok) return { ok: false, error: v.error };
    const s = sessionFor(v.cmd.project);
    if (!s) return { ok: false, error: 'There is no project by that name.' };
    try {
      return redactDeep(await actions[v.cmd.type](s, v.cmd));
    } catch (e) {
      log.error('helper', 'command failed', { type: v.cmd.type, error: e });
      return { ok: false, error: 'Something went wrong in the background helper. Nothing was approved.' };
    }
  }

  return {
    handleCommand,
    pendingCards,
    /** Quitting: every session closes and anything waiting is denied. */
    shutdown() { for (const s of sessions.values()) s.close(); },
  };
}
