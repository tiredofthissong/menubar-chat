// contract.mjs - the ONE agreement between the window and the helper.
//
// Window -> helper: commands. Every command is checked here before anything acts on it.
// Strict on purpose: an unknown command or an unexpected field is refused, not ignored.
// Helper -> window: events. Every event is built with event(), so its type is a known one.
// SDK message shapes never cross this line: only engine/translate.mjs reads them.
export const CONTRACT_VERSION = 1;

const FIELD = {
  project: (v) => typeof v === 'string' && /^[\w][\w .-]{0,63}$/.test(v),
  text: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 20000,
  ref: (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v),
  sessionId: (v) => typeof v === 'string' && /^[0-9a-f-]{8,64}$/i.test(v),
  short: (v) => typeof v === 'string' && v.length <= 40,
};

export const COMMANDS = {
  send: { project: 'project', text: 'text' },               // a message to Claude
  answer: { project: 'project', id: 'ref', decision: 'short' }, // only the exact "allow" approves
  stop: { project: 'project' },
  setMode: { project: 'project', mode: 'short' },           // 'default' (Ask me first) or 'plan'
  undo: { project: 'project', changeId: 'ref' },
  history: { project: 'project' },                          // past chats, from Claude Code's own files
  resume: { project: 'project', sessionId: 'sessionId' },
  newChat: { project: 'project' },
  replay: { project: 'project' },                           // what this window missed while it reloaded
};

export const EVENT_TYPES = [
  'session',          // { sessionId, mode } a chat started or resumed
  'mode',             // { mode, label } Ask me first or Plan first
  'text',             // { text } whole lines of Claude's reply
  'tool',             // { id, tool, line } one plain line per tool call
  'why',              // { seen, why, line } whether an edit came with a "Why:" line
  'approval',         // { card } an Allow / Deny card
  'approval_closed',  // { id, decision, why }
  'blocked',          // { rule, plain } a hard rule stopped a tool call; no button overrides it
  'tool_failed',      // { text }
  'change',           // { id, file, sentence, diff, canUndo } what changed and why
  'undo_result',      // { id, ok, text }
  'usage',            // { contextPct, chatUsd, spentUsd, capUsd }
  'hint',             // { text } a gentle note, e.g. an unknown /command
  'suggestions',      // { items } up to three next steps Claude suggested; each becomes a button that sends it
  'turn_done',        // { ok, approvals, costUsd, spentUsd, capUsd }
  'status',           // { state, line, pendingCards, busy } the menu bar's hover line
  'error',            // { code, text } plain words, never a stack trace
  'closed',           // {} the Claude process for this project ended
];

/** @returns {{ ok: true, cmd: object } | { ok: false, error: string }} */
export function validateCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'command must be an object' };
  const spec = Object.hasOwn(COMMANDS, raw.type) ? COMMANDS[raw.type] : null;
  if (!spec) return { ok: false, error: 'unknown command' };
  for (const key of Object.keys(raw)) if (key !== 'type' && !Object.hasOwn(spec, key)) return { ok: false, error: `unexpected field: ${key}` };
  for (const [key, kind] of Object.entries(spec)) if (!FIELD[kind](raw[key])) return { ok: false, error: `bad or missing field: ${key}` };
  return { ok: true, cmd: { ...raw } };
}

/** Build an event. Throws on an unknown type: a programmer error that the tests catch. */
export function event(type, fields = {}) {
  if (!EVENT_TYPES.includes(type)) throw new Error(`unknown event type: ${type}`);
  return { v: CONTRACT_VERSION, ...fields, type };
}
