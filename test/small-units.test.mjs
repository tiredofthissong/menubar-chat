// The small modules: usage meter, history list, the log, the two modes, and the 200-line budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMeter } from '../usage/meter.mjs';
import { listProjectSessions } from '../sidebar/sessions.mjs';
import { createLogger } from '../shared/log.mjs';
import { MODES, START_MODE, isAllowedMode, requestMode } from '../policy/modes.mjs';

test('meter: cost is the latest running total, context is a share of the largest window', () => {
  const m = createMeter();
  assert.deepEqual(m.snapshot(), { contextPct: null, chatUsd: 0, priceUnknown: false });
  m.onRequestTokens(50000);
  m.onResult({ chatUsd: 0.05, windows: [200000] });
  m.onResult({ chatUsd: 0.12, windows: [200000, 1000000] });
  assert.deepEqual(m.snapshot(), { contextPct: 5, chatUsd: 0.12, priceUnknown: false }, 'the chat cost comes from the budget record');
  m.onRequestTokens(-1); m.onResult({ chatUsd: -3, priceUnknown: true });
  assert.deepEqual(m.snapshot(), { contextPct: 5, chatUsd: 0.12, priceUnknown: true }, 'bad numbers are ignored; an unknown price shows as unknown');
  m.reset();
  assert.equal(m.snapshot().chatUsd, 0);
  m.reset(0.4);
  assert.equal(m.snapshot().chatUsd, 0.4, 'a past chat opens with what it had cost');
});

test('history: this folder only, newest first, no archived chats, titles cleaned', async () => {
  const project = { path: '/work/p' };
  const fake = async () => [
    { sessionId: 'a', cwd: '/work/p', lastModified: 1, firstPrompt: 'old one' },
    { sessionId: 'b', cwd: '/work/p', lastModified: 3, summary: 'set  up\nthe key sk-ant-abcdefghijklmnop' },
    { sessionId: 'c', cwd: '/work/other', lastModified: 9, summary: 'another folder' },
    { sessionId: 'd', cwd: '/work/p', lastModified: 5, archived: true },
    { sessionId: 'e', lastModified: 2 }, null, { nope: true },
  ];
  const list = await listProjectSessions(project, fake);
  assert.deepEqual(list.map((s) => s.sessionId), ['b', 'e', 'a']);
  assert.equal(list[0].title, 'set up the key [hidden secret]');
  assert.equal(list[1].title, 'Untitled chat');
  assert.deepEqual(await listProjectSessions(project, async () => 'not a list'), []);
});

test('log: what you typed and file text are never written, only their length; secrets hidden', () => {
  const lines = []; const log = createLogger({ sink: (l) => lines.push(l), level: 'info' });
  log.debug('x', 'too quiet');
  log.info('session', 'sent', { text: 'my private note', project: 'p', note: 'token sk-ant-abcdefghijklmnop', err: new Error('boom') });
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.textLength, 15);
  assert.equal(entry.text, undefined);
  assert.equal(entry.note, 'token [hidden secret]');
  assert.equal(entry.err, 'boom');
  assert.doesNotMatch(lines[0], /private note|sk-ant-abc/);
  assert.doesNotThrow(() => createLogger({ sink: () => { throw new Error('disk full'); } }).error('a', 'b'));
});

test('modes: only Ask me first, Plan first and Dev mode, starting in Ask me first', () => {
  assert.deepEqual(Object.keys(MODES), ['default', 'plan', 'dev']);
  assert.equal(START_MODE, 'default');
  for (const m of ['acceptEdits', 'bypassPermissions', 'auto', 'dontAsk', 'toString', '__proto__', null, 1]) assert.equal(isAllowedMode(m), false, String(m));
  assert.deepEqual(requestMode('plan'), { ok: true, mode: 'plan', label: 'Plan first' });
  assert.equal(requestMode('acceptEdits').ok, false);
});

// The 200-line budget keeps each file small enough to read in one go. No exceptions.
const BUDGET = 200;
const EXEMPT = new Set();
test('every source file is 200 lines or fewer', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const skip = new Set(['node_modules', 'test', '.git', 'dist', 'out']);
  const over = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(mjs|js|cjs)$/.test(e.name)) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        const lines = fs.readFileSync(full, 'utf8').split('\n').length - 1;
        if (lines > BUDGET && !EXEMPT.has(rel)) over.push(`${rel} (${lines})`);
      }
    }
  };
  walk(root);
  assert.deepEqual(over, []);
});
