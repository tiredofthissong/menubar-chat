// End to end: the REAL Agent SDK talking to the fake Claude Code binary (mock/fake-claude.mjs).
// No API key, no network, no cost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ProjectSession } from '../engine/session.mjs';
import { StatusBoard } from '../engine/status.mjs';
import { Budget } from '../engine/budget.mjs';
import { KEYCHAIN_SERVICE } from '../engine/options.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';

function harness({ tag = 'personal', keySource, cap = 5 } = {}) {
  const events = []; const waiters = [];
  const emit = (ev) => { events.push(ev); for (const w of [...waiters]) if (w.pred(ev)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); } };
  const status = new StatusBoard(); const budget = new Budget(cap);
  const session = new ProjectSession({
    project: { name: `${tag}-demo`, path: process.cwd(), tag }, sdk: { query }, emit, status, budget,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: ['~/claude-hub'], spawn: (o) => createFakeClaude(o, { keySource }) },
  });
  const next = (pred, ms = 8000) => {
    const seen = events.find(pred); if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve }; waiters.push(w);
      setTimeout(() => reject(new Error(`timed out; saw: ${events.map((e) => e.type).join(',')}`)), ms).unref();
    });
  };
  return { session, events, next, status, budget, of: (type) => events.filter((e) => e.type === type) };
}

test('a chained command arrives as ONE card that lists every step', async (t) => {
  const h = harness(); t.after(() => h.session.close());
  h.session.send('#chain please');
  const ap = await h.next((e) => e.type === 'approval');
  assert.equal(ap.project, 'personal-demo');
  assert.equal(ap.card.steps.length, 3);
  assert.match(ap.card.plain, /Run 3 steps: download the latest changes; make a folder; copy files\./);
  assert.equal(ap.card.defaultChoice, 'deny');
  assert.equal(h.status.top().state, 'waiting');
  h.session.answer(ap.card.id, 'allow');
  const done = await h.next((e) => e.type === 'turn_done');
  assert.equal(done.approvals, 1);
  assert.equal(h.of('approval').length, 1);
  assert.equal(h.of('tool_failed').length, 0);
});

test('Deny, Stop and a typed reply all mean no', async (t) => {
  const h = harness(); t.after(() => h.session.close());
  h.session.send('#chain');
  let ap = await h.next((e) => e.type === 'approval');
  h.session.answer(ap.card.id, 'Allow'); // wrong case is a no
  assert.equal((await h.next((e) => e.type === 'approval_closed')).decision, 'deny');
  await h.next((e) => e.type === 'turn_done');
  assert.equal(h.of('tool_failed').length, 0, 'a no is shown once, on the card line, not again as a failure');

  h.events.length = 0;
  h.session.send('#chain again');
  ap = await h.next((e) => e.type === 'approval');
  await h.session.stop();
  const closed = await h.next((e) => e.type === 'approval_closed');
  assert.equal(closed.decision, 'deny');

  h.events.length = 0;
  h.session.send('#chain once more');
  await h.next((e) => e.type === 'approval');
  h.session.send('no, do it differently'); // typing while a card waits
  const typed = await h.next((e) => e.type === 'approval_closed');
  assert.equal(typed.decision, 'deny');
  assert.match(typed.why, /You sent a new message instead/);
});

test('work project: git push is blocked by the hook even when an allow rule would skip the card', async (t) => {
  const h = harness({ tag: 'work' }); t.after(() => h.session.close());
  h.session.send('#push');
  const blocked = await h.next((e) => e.type === 'blocked');
  assert.equal(blocked.rule, 'work-publish');
  await h.next((e) => e.type === 'turn_done');
  assert.equal(h.of('approval').length, 0, 'no card: it never reached the person');
  assert.match(blocked.plain, /git push is switched off/);
  assert.equal(h.of('tool_failed').length, 0, 'said once, as "Blocked", not twice');
});

test('personal project: the same push with an allow rule goes through (only work is locked)', async (t) => {
  const h = harness({ tag: 'personal' }); t.after(() => h.session.close());
  h.session.send('#push');
  await h.next((e) => e.type === 'turn_done');
  assert.equal(h.of('blocked').length, 0);
});

test('secret files are refused in every project', async (t) => {
  const h = harness({ tag: 'personal' }); t.after(() => h.session.close());
  h.session.send('#secret');
  const b = await h.next((e) => e.type === 'blocked');
  assert.equal(b.rule, 'secret-file');
});

test('the wrong credential stops the session before anything runs', async (t) => {
  const h = harness({ keySource: 'none' }); t.after(() => h.session.close());
  h.session.send('#chain');
  const err = await h.next((e) => e.type === 'error');
  assert.equal(err.code, 'wrong-credential');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(h.of('approval').length, 0);
});

test('a key split across two chunks never reaches the window', async (t) => {
  const h = harness(); t.after(() => h.session.close());
  h.session.send('#leak');
  await h.next((e) => e.type === 'turn_done');
  const shown = h.of('text').map((e) => e.text).join('');
  assert.doesNotMatch(shown, /cdef1234567890/);
  assert.match(shown, /ok/);
});

test('edits report whether a Why: line came first', async (t) => {
  const h = harness(); t.after(() => h.session.close());
  h.session.send('#edit');
  const why = await h.next((e) => e.type === 'why');
  assert.equal(why.seen, true);
  assert.match(why.why, /typo/);
  const ap = await h.next((e) => e.type === 'approval');
  h.session.answer(ap.card.id, 'deny');
  await h.next((e) => e.type === 'turn_done');

  h.events.length = 0;
  h.session.send('#nowhy');
  const none = await h.next((e) => e.type === 'why');
  assert.equal(none.seen, false);
});

test('the spending cap refuses new messages', async (t) => {
  const h = harness({ cap: 0.01 }); t.after(() => h.session.close());
  h.session.send('#hello');
  const done = await h.next((e) => e.type === 'turn_done');
  assert.equal(done.spentUsd, 0.01);
  h.session.send('#hello again');
  const err = await h.next((e) => e.type === 'error');
  assert.equal(err.code, 'budget');
});
