// one-card.test.mjs - steps of one kind that Claude asks for together share one card, with one
// answer (Bromo, Nov 26: prompt 6 put up three web search cards; "it should all be one permission").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ApprovalBroker, TRASH_INSTEAD } from '../policy/approvals.mjs';
import { groupKey } from '../policy/grouping.mjs';
import { explainToolCall } from '../shared/explain.mjs';
import { createHelper } from '../engine/helper.mjs';
import { Budget } from '../usage/budget.mjs';
import { KEYCHAIN_SERVICE } from '../engine/options.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';
import { tempProject, collector } from './support.mjs';

const P = '/p';
const card = (tool, input) => explainToolCall(tool, input, P);
const broker = () => {
  const opened = []; const closed = [];
  const b = new ApprovalBroker({ onOpen: (c) => opened.push(c), onClose: (...a) => closed.push(a), timeoutMs: 0 });
  const up = () => opened.filter((c) => !closed.some(([id]) => id === c.id));
  return { b, opened, closed, up };
};

test('what shares a card: one kind of step only; a delete, an install or a question never rides along', () => {
  const key = (t, i) => groupKey(t, card(t, i));
  assert.equal(key('WebSearch', { query: 'a' }), key('WebSearch', { query: 'b' }));
  assert.equal(key('WebSearch', { query: 'a' }), key('WebFetch', { url: 'https://x.org', prompt: 'p' }), 'web lookups together');
  assert.notEqual(key('WebSearch', { query: 'a' }), key('Bash', { command: 'npm install x' }), 'an install is not a web lookup');
  assert.equal(key('Edit', { file_path: 'a.txt', old_string: 'a', new_string: 'b' }), key('Edit', { file_path: 'b.txt', old_string: 'a', new_string: 'b' }));
  assert.notEqual(key('Bash', { command: 'rm a.txt' }), key('Bash', { command: 'touch a.txt' }), 'a delete stays apart');
  assert.equal(groupKey('AskUserQuestion', { kind: 'question' }), null);
});

test('one card lists every step; one Deny says no to all of them', async () => {
  const { b, up } = broker();
  const edits = ['a.txt', 'b.txt'].map((f) => b.ask('Edit', { file_path: f }, { toolUseID: f }, card('Edit', { file_path: f, old_string: 'x', new_string: 'y' })));
  assert.equal(b.size, 1);
  const [c] = up();
  assert.equal(c.what, 'take 2 steps'); assert.deepEqual(c.items.map((i) => i.say), ['Change a.txt', 'Change b.txt']);
  b.answer(c.id, 'deny');
  for (const r of await Promise.all(edits)) assert.equal(r.behavior, 'deny');
});

test('deletes asked together: one red card, Move to Trash covers them all', async () => {
  const { b, up } = broker();
  const rms = ['rm a.txt', 'rm b.txt'].map((command) => b.ask('Bash', { command }, {}, card('Bash', { command })));
  const [c] = up();
  assert.equal(b.size, 1); assert.equal(c.trash, true); assert.equal(c.danger, true);
  assert.equal(c.command, 'rm a.txt\nrm b.txt', 'the exact commands, both of them');
  b.answer(c.id, 'trash');
  for (const r of await Promise.all(rms)) { assert.equal(r.behavior, 'deny'); assert.equal(r.message, TRASH_INSTEAD); }
});

test('a step that joins, or one Claude stops, puts up a new card; the old one no longer answers', async () => {
  const ac = new AbortController(); const { b, closed, up } = broker();
  const one = b.ask('WebSearch', { query: 'a' }, { signal: ac.signal }, card('WebSearch', { query: 'a' }));
  const first = up()[0];
  const two = b.ask('WebSearch', { query: 'b' }, {}, card('WebSearch', { query: 'b' }));
  assert.deepEqual(closed.at(-1).slice(0, 2), [first.id, 'merged']);
  const second = up()[0]; assert.equal(second.regrouped, true); assert.equal(second.items.length, 2);
  assert.equal(b.answer(first.id, 'allow'), false, 'you only allow the steps you saw');
  ac.abort();
  assert.equal((await one).behavior, 'deny');
  const third = up()[0]; assert.equal(third.what, 'search the web for "b"', 'back to one step');
  b.answer(third.id, 'allow'); assert.equal((await two).behavior, 'allow');
  assert.equal(b.size, 0);
});

test('a question always gets its own card', () => {
  const { b } = broker();
  const qs = { questions: [{ question: 'Which?', header: 'x', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }] };
  b.ask('AskUserQuestion', qs, {}, { kind: 'question' }); b.ask('AskUserQuestion', qs, {}, { kind: 'question' });
  assert.equal(b.size, 2); b.denyAll('done');
});

test('end to end, Dev mode: three searches at once are one card, and one Allow runs all three', async (t) => {
  const dir = tempProject(); const c = collector();
  const helper = createHelper({
    projects: [{ name: 'garden', path: dir, tag: 'personal' }], sdk: { query }, budget: new Budget(5), log: silentLogger, send: c.push,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: [], spawn: (o) => createFakeClaude(o) },
  });
  t.after(() => { helper.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  await helper.handleCommand({ type: 'setMode', project: 'garden', mode: 'dev' });
  await helper.handleCommand({ type: 'send', project: 'garden', text: '#searches' });
  const web = (await c.next((e) => e.type === 'approval')).card;
  assert.equal(web.what, 'search the web 3 times'); assert.equal(web.hour, true);
  assert.equal(web.reason, 'you asked which plants grow in shade.', 'the one Why: line covers all three');
  await helper.handleCommand({ type: 'answer', project: 'garden', id: web.id, decision: 'allow' });
  await c.next((e) => e.type === 'turn_done');
  assert.equal(c.of('approval').length, 1, 'one card, not three');
  assert.equal(c.of('tool_failed').length, 0, 'all three searches ran');
});
