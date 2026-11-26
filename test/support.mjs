// support.mjs - small helpers shared by the test files (not a test file itself).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A throwaway project folder with a notes.txt that has a typo in it. */
export function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-'));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'I wrote teh notes.\nSecond line.\n');
  return dir;
}

/** Collects events; next(pred) waits for the first one that matches (already seen counts). */
export function collector() {
  const events = []; const waiters = [];
  const push = (ev) => { events.push(ev); for (const w of [...waiters]) if (w.pred(ev)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); } };
  const next = (pred, ms = 8000) => {
    const seen = events.find(pred); if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve }; waiters.push(w);
      setTimeout(() => reject(new Error(`timed out; saw: ${events.map((e) => e.type || e.kind).join(',')}`)), ms).unref();
    });
  };
  return { events, push, next, of: (type) => events.filter((e) => e.type === type) };
}
