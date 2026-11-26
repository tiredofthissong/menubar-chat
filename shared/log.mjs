// log.mjs - one JSON line per entry, with secrets impossible by construction.
//  1. Content fields (what you typed, commands, file text, tool input) are never written:
//     only their length, so the log still shows that something happened.
//  2. Everything else goes through redactDeep before it is written.
import { redactDeep } from './redact.mjs';

const CONTENT_FIELDS = new Set(['text', 'input', 'content', 'command', 'prompt', 'body', 'old_string', 'new_string', 'diff']);
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function scrub(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (CONTENT_FIELDS.has(k)) out[`${k}Length`] = typeof v === 'string' ? v.length : JSON.stringify(v ?? '').length;
    else out[k] = v instanceof Error ? v.message : v;
  }
  return redactDeep(out);
}

/** @param {{ sink?: (line: string) => void, level?: 'debug'|'info'|'warn'|'error' }} [o] */
export function createLogger({ sink = (l) => process.stderr.write(l + '\n'), level = 'info' } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, area, msg, fields) => {
    if (LEVELS[lvl] < min) return;
    try { sink(JSON.stringify({ t: new Date().toISOString(), lvl, area, msg: redactDeep(String(msg)), ...scrub(fields) })); } catch { /* a log must never break the app */ }
  };
  return Object.fromEntries(Object.keys(LEVELS).map((l) => [l, (area, msg, f) => write(l, area, msg, f)]));
}

export const silentLogger = createLogger({ sink: () => {} });
