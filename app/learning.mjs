// learning.mjs - the learning log: each card you see adds one line, tagged with its Claude Academy
// course, to learning-log.jsonl in the app's own folder. The Usage panel shows what you've met,
// by course, with the course one click away. Links open only if shared/learn.mjs vouches for them.
import fs from 'node:fs';
import path from 'node:path';
import { COURSES, TOPICS, isLearnLink } from '../shared/learn.mjs';

const KEEP = 2000; // lines; the oldest go first

/** One log line for a card, or null. Only the topic and its tag: never the command or a file name. */
export function entryFor(ev, at = new Date()) {
  const topic = ev?.card?.learn?.topic;
  if (!Object.hasOwn(TOPICS, topic)) return null;
  return { at: at.toISOString(), project: String(ev.project || ''), topic, course: TOPICS[topic].course };
}

/** The log by course: how often, which topics, and when last. Courses you haven't met come last. */
export function summarize(entries) {
  const by = new Map(Object.keys(COURSES).map((c) => [c, { course: c, url: COURSES[c], count: 0, topics: [], last: null }]));
  for (const e of entries) {
    const s = by.get(e?.course);
    if (!s || !Object.hasOwn(TOPICS, e.topic)) continue;
    s.count++; if (!s.topics.includes(e.topic)) s.topics.push(e.topic);
    if (!s.last || e.at > s.last) s.last = e.at;
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

export function readLog(file) {
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export function createLearning({ ipcMain, shell, fromOurWindow, file }) {
  let lines = readLog(file).length;
  function record(ev) {
    const e = entryFor(ev);
    if (!e) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify(e) + '\n');
      if (++lines > KEEP * 1.5) { const keep = readLog(file).slice(-KEEP); fs.writeFileSync(file, keep.map((x) => JSON.stringify(x)).join('\n') + '\n'); lines = keep.length; }
    } catch { /* the log is a nice-to-have; a full disk never stops a card */ }
  }
  ipcMain.handle('learn:summary', (e) => (fromOurWindow(e) ? { ok: true, courses: summarize(readLog(file)) } : { ok: false }));
  ipcMain.handle('learn:open', (e, url) => {
    if (!fromOurWindow(e) || !isLearnLink(url)) return { ok: false, error: 'That link is not on the checked list, so it was not opened.' };
    shell.openExternal(url); return { ok: true };
  });
  return { record };
}
