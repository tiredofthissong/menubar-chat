// The background process and Electron's built-in messaging, without Electron: the same
// helper-link (app side) and serve (helper side) code, joined by an in-memory port pair that
// copies every message the way Electron does (structured clone). Real SDK, fake Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createHelperLink } from '../app/helper-link.mjs';
import { serveHelper } from '../engine/serve.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';
import { tempProject, collector } from './support.mjs';

// fork() stand-in: a "child" the link talks to, and a parent port the helper listens on.
function fakeFork(log) {
  return () => {
    const child = new EventEmitter(); const parentPort = new EventEmitter();
    child.postMessage = (m) => setImmediate(() => parentPort.emit('message', { data: structuredClone(m) }));
    parentPort.postMessage = (m) => setImmediate(() => child.emit('message', structuredClone(m)));
    child.kill = () => { served.helper?.shutdown(); setImmediate(() => child.emit('exit', 0)); };
    const served = serveHelper(parentPort, { sdk: { query }, spawn: (o) => createFakeClaude(o), log: silentLogger, exit: () => child.emit('exit', 0) });
    log.push(child);
    return child;
  };
}

function setup() {
  const dir = tempProject(); const spendDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-spend-'));
  const c = collector(); const children = []; const exits = []; const readies = [];
  const link = createHelperLink({
    fork: fakeFork(children), entry: 'engine/helper-process.mjs', onEvent: c.push, onExit: (code) => exits.push(code), onReady: (m) => readies.push(m),
    boot: () => ({ projects: [{ name: 'personal-demo', path: dir, tag: 'personal' }], capUsd: 5, spendFile: path.join(spendDir, 'spend-today.json'),
      settings: { keychainService: 'claude-menubar-anthropic', hubPaths: ['~/claude-hub'] } }),
  });
  const done = () => { link.stop(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(spendDir, { recursive: true, force: true }); };
  return { ...c, link, children, exits, readies, spendDir, done };
}

test('boot, chat, an Allow card and the spend file, all over messages', async (t) => {
  const s = setup(); t.after(s.done);
  const ready = await s.link.start();
  assert.equal(ready.spentUsd, 0);
  assert.deepEqual(await s.link.command({ type: 'send', project: 'personal-demo', text: '#chain' }), { ok: true });
  const ap = await s.next((e) => e.type === 'approval');
  assert.equal(ap.card.defaultChoice, 'deny');
  assert.deepEqual(await s.link.command({ type: 'answer', project: 'personal-demo', id: ap.card.id, decision: 'allow' }), { ok: true });
  const done = await s.next((e) => e.type === 'turn_done');
  assert.equal(done.approvals, 1);
  assert.ok(s.events.some((e) => e.type === 'status' && e.pendingCards === 1), 'the app learns a card is open (keeps the window up)');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.spendDir, 'spend-today.json'), 'utf8')).spent, 0.01);
});

test('the helper checks commands too, whatever the app sends', async (t) => {
  const s = setup(); t.after(s.done);
  await s.link.start();
  assert.equal((await s.link.command({ type: 'send', project: 'personal-demo', text: 'x', permissionMode: 'bypassPermissions' })).ok, false);
  assert.equal((await s.link.command({ type: 'answer', project: 'personal-demo', id: 'x', decision: 'allow', force: true })).ok, false);
});

test('if the helper stops, waiting commands get a plain no, and the next command starts it again', async (t) => {
  const s = setup(); t.after(s.done);
  await s.link.start();
  await s.link.command({ type: 'send', project: 'personal-demo', text: '#chain' });
  await s.next((e) => e.type === 'approval');
  const pending = new Promise((resolve) => { s.children[0].postMessage = () => {}; resolve(s.link.command({ type: 'stop', project: 'personal-demo' })); }); // never answered
  s.children[0].kill();
  const r = await (await pending);
  assert.equal(r.ok, false);
  assert.match(r.error, /nothing was approved/);
  assert.equal(s.exits.length, 1);
  assert.equal(s.link.running, false);
  assert.deepEqual(await s.link.command({ type: 'send', project: 'personal-demo', text: '#hello' }), { ok: true });
  assert.equal(s.children.length, 2, 'started again');
  await s.next((e) => e.type === 'turn_done' && e.ok);
});

test('quitting asks the helper to close every session (anything waiting is denied)', async (t) => {
  const s = setup(); t.after(s.done);
  await s.link.start();
  await s.link.command({ type: 'send', project: 'personal-demo', text: '#chain' });
  await s.next((e) => e.type === 'approval');
  s.link.stop();
  const closed = await s.next((e) => e.type === 'approval_closed');
  assert.equal(closed.decision, 'deny');
  assert.match(closed.why, /closed before you answered/);
});
