// helper-link.mjs - the app's side of the background process: starts it, sends it commands,
// passes its events on, and starts it again if it stops. Electron is passed in (fork), so the
// tests can run the same code with an in-memory port.
//
// If the helper stops while a card is waiting, nothing was approved: its Claude Code processes
// end with it, and every command still waiting gets a plain "no" back.
export function createHelperLink({ fork, entry, boot, onEvent, onExit = () => {}, onReady = () => {} }) {
  let child = null; let seq = 0; const calls = new Map();
  let ready = null; let markReady = () => {};

  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'event') onEvent(msg.ev);
    else if (msg.kind === 'ready') { onReady(msg); markReady(msg); }
    else if (msg.kind === 'reply') { const done = calls.get(msg.id); calls.delete(msg.id); done?.(msg.result); }
  }

  function start() {
    ready = new Promise((r) => { markReady = r; });
    const c = fork(entry);
    child = c;
    c.on('message', onMessage);
    c.on('exit', (code) => {
      if (child !== c) return;
      child = null;
      for (const done of calls.values()) done({ ok: false, error: 'The background helper stopped, so nothing was approved. Press Send to start it again.' });
      calls.clear();
      onExit(code);
    });
    c.postMessage({ kind: 'boot', ...boot() });
  }

  return {
    get running() { return Boolean(child); },
    start() { if (!child) start(); return ready; },
    /** @returns {Promise<object>} the helper's plain-words answer */
    command(cmd) {
      if (!child) start();
      return new Promise((resolve) => { const id = ++seq; calls.set(id, resolve); child.postMessage({ kind: 'command', id, cmd }); });
    },
    /** The project list changed: the helper picks it up without a restart. */
    projects(list) { if (child) child.postMessage({ kind: 'projects', projects: list }); },
    stop() {
      const c = child; child = null;
      if (!c) return;
      try { c.postMessage({ kind: 'shutdown' }); } catch { /* already gone */ }
      setTimeout(() => { try { c.kill(); } catch { /* already gone */ } }, 1000).unref?.();
    },
  };
}
