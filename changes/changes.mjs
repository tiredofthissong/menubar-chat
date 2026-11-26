// changes.mjs - "what changed and why" cards, and one-click undo that never loses work.
//  1. snapshotBefore(): the PreToolUse hook saves the file's text right before Claude edits it.
//     If saving fails it throws, and the hook's onFailure 'block' stops the edit: no copy, no edit.
//  2. recordAfter(): after the edit, remember a fingerprint of what Claude wrote; build the card.
//  3. undo(): put the old text back ONLY if the file still holds exactly what Claude wrote.
//     If anyone changed it since, refuse and say so. Never write over newer work.
// Files outside the project folder get no copy and no Undo (the edit still needs its card).
// Copies live in memory: they are gone after the app quits (known gap, see DESIGN.md).
// Ideas from Nimbalyst (MIT), rewritten; adapted from this project's code-health prototype.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const sha = (text) => (text === null ? 'absent' : createHash('sha256').update(text).digest('hex'));
const readOrNull = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The real path of a file if it sits inside the project folder (symlinks followed), else null. */
export function insideProject(cwd, filePath) {
  const root = fs.realpathSync(cwd);
  const abs = path.resolve(root, String(filePath));
  const dir = fs.existsSync(path.dirname(abs)) ? fs.realpathSync(path.dirname(abs)) : null;
  if (!dir) return abs.startsWith(root + path.sep) ? abs : null;
  const real = path.join(dir, path.basename(abs));
  return real.startsWith(root + path.sep) ? real : null;
}

/** One sentence from a structuredPatch plus Claude's own "Why:" line. */
export function describe(file, hunks, isNew, why) {
  let added = 0; let removed = 0;
  for (const h of hunks || []) for (const l of h.lines || []) { if (l[0] === '+') added++; else if (l[0] === '-') removed++; }
  const changed = Math.min(added, removed);
  const parts = [];
  if (changed) parts.push(`changed ${plural(changed, 'line')}`);
  if (added - changed) parts.push(`added ${plural(added - changed, 'line')}`);
  if (removed - changed) parts.push(`removed ${plural(removed - changed, 'line')}`);
  const what = isNew ? `Created ${file}` : `${(parts.join(' and ') || 'Changed').replace(/^./, (c) => c.toUpperCase())} in ${file}`;
  return `${what}. ` + (why ? `Why: ${why.replace(/[.!\s]+$/, '')}.` : "Claude didn't say why.");
}

export class ChangeStore {
  constructor(cwd) { this.cwd = cwd; this.items = new Map(); } // toolUseId -> { abs, before, afterHash, undone }

  /** @returns {boolean} whether a copy was kept */
  snapshotBefore(toolUseId, filePath) {
    const abs = insideProject(this.cwd, filePath);
    if (!abs) return false;
    this.items.set(toolUseId, { abs, before: readOrNull(abs), afterHash: null, undone: false });
    return true;
  }

  /** After the tool succeeded. Returns a card for the window, or null if no copy was kept. */
  recordAfter(toolUseId, { hunks, why } = {}) {
    const item = this.items.get(toolUseId);
    if (!item) return null;
    item.afterHash = sha(readOrNull(item.abs));
    const file = path.relative(fs.realpathSync(this.cwd), item.abs);
    return { id: toolUseId, file, sentence: describe(file, hunks, item.before === null, why), diff: hunks || [], canUndo: true };
  }

  /** A denied or failed edit: forget the copy. */
  forget(toolUseId) { this.items.delete(toolUseId); }

  /** @returns {{ ok: boolean, code?: string, text: string }} */
  undo(toolUseId) {
    const item = this.items.get(toolUseId);
    if (!item || !item.afterHash || item.undone) return { ok: false, code: 'nothing', text: 'There is nothing to undo for this change.' };
    if (sha(readOrNull(item.abs)) !== item.afterHash) {
      return { ok: false, code: 'changed-since', text: `${path.basename(item.abs)} changed after Claude edited it, so undo would throw away newer work. Nothing was changed.` };
    }
    if (item.before === null) fs.rmSync(item.abs);
    else fs.writeFileSync(item.abs, item.before);
    item.undone = true;
    return { ok: true, text: `Put ${path.basename(item.abs)} back the way it was.` };
  }
}
