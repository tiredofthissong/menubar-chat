// wrapup.mjs - the Wrap up button: one dated entry at the end of HANDOFF.md in the project folder,
// so the next chat (or the next person) knows where things stand. It writes that one file and
// nothing else, and only ever adds to the end. The entry is built from what the window already saw.
import fs from 'node:fs';
import path from 'node:path';
import { redact } from '../shared/redact.mjs';

const clip = (s, n) => { const t = redact(String(s)).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** A record of one chat, fed every event the helper publishes and every message you send. */
export function createChatRecord() {
  const r = { asks: [], changes: [], allowed: 0, denied: 0, blocked: 0, costUsd: 0, next: [] };
  return {
    ask(text) { if (r.asks.length < 5) r.asks.push(clip(text, 120)); },
    note(ev) {
      if (ev.type === 'change' && r.changes.length < 12) r.changes.push(clip(ev.sentence, 160));
      else if (ev.type === 'approval_closed' && ev.decision !== 'merged') { if (ev.decision === 'allow') r.allowed++; else r.denied++; }
      else if (ev.type === 'blocked') r.blocked++;
      else if (ev.type === 'turn_done') r.costUsd += Number(ev.costUsd) || 0;
      else if (ev.type === 'suggestions') r.next = (ev.items || []).slice(0, 3).map((x) => clip(x, 80));
    },
    get data() { return r; },
  };
}

const two = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;

/** The entry's Markdown. Empty sections are left out. */
export function entryText(r, { project, at = new Date() }) {
  const out = [`## ${stamp(at)} · ${project} · chat wrap-up`, ''];
  if (r.asks.length) out.push(`- **You asked:** ${r.asks.join(' / ')}`);
  if (r.changes.length) { out.push('- **Changed:**'); for (const c of r.changes) out.push(`  - ${c}`); } else out.push('- **Changed:** nothing in this chat.');
  out.push(`- **Cards:** ${r.allowed} allowed, ${r.denied} not run${r.blocked ? `, ${r.blocked} blocked by the safety rules` : ''}.`);
  out.push(`- **Spent:** $${r.costUsd.toFixed(2)} in this chat.`);
  if (r.next.length) out.push(`- **Suggested next:** ${r.next.join(' / ')}`);
  return out.join('\n') + '\n';
}

/**
 * Add the entry to <dir>/HANDOFF.md, making the file if needed. A HANDOFF.md that is a link or a
 * folder is left alone, so the entry can't land somewhere else.
 * @returns {{ ok: boolean, text: string }}
 */
export function appendHandoff(dir, entry) {
  const file = path.join(dir, 'HANDOFF.md');
  let st = null; try { st = fs.lstatSync(file); } catch { /* not there yet */ }
  if (st && !st.isFile()) return { ok: false, text: 'HANDOFF.md here is a link or a folder, so nothing was written.' };
  if (!st) { fs.writeFileSync(file, `# HANDOFF\n\nWhere things stand, newest last. Each entry comes from the Wrap up button.\n\n${entry}`, { flag: 'wx' }); return { ok: true, text: 'Started HANDOFF.md in this folder with a wrap-up of this chat.' }; }
  const before = fs.readFileSync(file, 'utf8');
  const gap = before.length === 0 ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  fs.appendFileSync(file, gap + entry);
  return { ok: true, text: 'Added a wrap-up of this chat to the end of HANDOFF.md.' };
}
