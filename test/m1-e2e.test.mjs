// Milestone 1, end to end: change cards and Undo, the two modes, slash-command hints,
// sub-agent chatter, usage. Real Agent SDK + fake Claude Code binary, through the helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createHelper } from '../engine/helper.mjs';
import { Budget } from '../usage/budget.mjs';
import { KEYCHAIN_SERVICE } from '../engine/options.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';
import { tempProject, collector } from './support.mjs';

function harness({ tag = 'personal', listSessions } = {}) {
  const c = collector(); const dir = tempProject(); const name = `${tag}-demo`;
  const helper = createHelper({
    projects: [{ name, path: dir, tag }], sdk: { query, listSessions }, budget: new Budget(5), log: silentLogger, send: c.push,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: ['~/claude-hub'], spawn: (o) => createFakeClaude(o) },
  });
  const cmd = (type, f = {}) => helper.handleCommand({ type, project: name, ...f });
  const notes = () => fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8');
  const close = () => { helper.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { ...c, helper, cmd, dir, notes, close };
}

async function allowEdit(h) {
  await h.cmd('send', { text: '#edit' });
  const ap = await h.next((e) => e.type === 'approval');
  await h.cmd('answer', { id: ap.card.id, decision: 'allow' });
  return h.next((e) => e.type === 'change');
}

test('an allowed edit gets a "what changed and why" card, and Undo puts the file back', async (t) => {
  const h = harness(); t.after(h.close);
  const ch = await allowEdit(h);
  assert.equal(ch.file, 'notes.txt');
  assert.equal(ch.sentence, 'Changed 1 line in notes.txt. Why: notes.txt has a typo.');
  assert.equal(ch.canUndo, true);
  assert.match(h.notes(), /the notes/);
  const r = await h.cmd('undo', { changeId: ch.id });
  assert.equal(r.ok, true);
  assert.match(h.notes(), /teh notes/, 'back the way it was');
  assert.equal((await h.next((e) => e.type === 'undo_result')).ok, true);
  assert.equal((await h.cmd('undo', { changeId: ch.id })).ok, false, 'a second undo does nothing');
});

test('Undo refuses when the file changed again after Claude edited it', async (t) => {
  const h = harness(); t.after(h.close);
  const ch = await allowEdit(h);
  fs.appendFileSync(path.join(h.dir, 'notes.txt'), 'My own new line.\n');
  const r = await h.cmd('undo', { changeId: ch.id });
  assert.equal(r.ok, false);
  assert.match(r.text, /changed after Claude edited it/);
  assert.match(h.notes(), /My own new line/, 'your newer work is kept');
});

test('a denied edit leaves the file alone and makes no change card', async (t) => {
  const h = harness(); t.after(h.close);
  await h.cmd('send', { text: '#edit' });
  const ap = await h.next((e) => e.type === 'approval');
  await h.cmd('answer', { id: ap.card.id, decision: 'deny' });
  await h.next((e) => e.type === 'turn_done');
  assert.equal(h.of('change').length, 0);
  assert.match(h.notes(), /teh notes/);
});

test('Plan first: changes are refused by the mode, and approving the plan goes back to Ask me first', async (t) => {
  const h = harness(); t.after(h.close);
  const set = await h.cmd('setMode', { mode: 'plan' });
  assert.deepEqual(set, { ok: true, mode: 'plan' });
  assert.equal((await h.next((e) => e.type === 'mode')).label, 'Plan first');
  await h.cmd('send', { text: '#edit' });
  await h.next((e) => e.type === 'turn_done');
  assert.equal(h.of('approval').length, 0, 'no card: in Plan first nothing is changed');
  assert.match(h.notes(), /teh notes/);
  assert.ok(h.of('tool_failed').some((e) => /Plan mode/.test(e.text)));
  assert.equal(h.of('error').length, 0, 'the session started in plan mode as asked');

  h.events.length = 0;
  await h.cmd('send', { text: '#plan' });
  const ap = await h.next((e) => e.type === 'approval');
  assert.match(ap.card.plain, /The plan is ready/);
  await h.cmd('answer', { id: ap.card.id, decision: 'allow' });
  const back = await h.next((e) => e.type === 'mode');
  assert.equal(back.mode, 'default');
  await h.next((e) => e.type === 'turn_done');
  h.events.length = 0;
  await h.cmd('send', { text: '#hello' });
  await h.next((e) => e.type === 'turn_done');
  assert.equal(h.of('error').length, 0, 'the next turn starts in the mode we expect');
});

test('only the two modes exist', async (t) => {
  const h = harness(); t.after(h.close);
  for (const m of ['acceptEdits', 'bypassPermissions', 'auto', 'dontAsk', 'Plan', '']) {
    const r = await h.cmd('setMode', { mode: m });
    assert.equal(r.ok, false, m);
  }
});

test('a slash command this project does not have gets a one-line fix, and nothing is sent', async (t) => {
  const h = harness(); t.after(h.close);
  await h.cmd('send', { text: '#hello' });
  await h.next((e) => e.type === 'turn_done');
  await h.cmd('send', { text: '/desgin-rules' });
  const hint = await h.next((e) => e.type === 'hint');
  assert.match(hint.text, /There's no \/desgin-rules in personal-demo\. Did you mean \/design-rules\?/);
  assert.equal(hint.kind, 'slash-typo');
  assert.match(hint.text, /\/design-rules/);
  assert.equal(h.of('turn_done').length, 1);
});

test("sub-agent chatter stays out of the main chat; usage reports this chat's cost and memory", async (t) => {
  const h = harness(); t.after(h.close);
  await h.cmd('send', { text: '#sub' });
  const u = await h.next((e) => e.type === 'usage');
  const shown = h.of('text').map((e) => e.text).join('');
  assert.match(shown, /Main line/);
  assert.doesNotMatch(shown, /Sub-agent chatter/);
  assert.equal(u.chatUsd, 0.01);
  assert.equal(u.contextPct, 0.6);
  assert.equal(u.capUsd, 5);
});

test('history comes from Claude Code\'s own session list, for this folder only', async (t) => {
  const seen = [];
  const h = harness({ listSessions: async (o) => { seen.push(o); return [
    { sessionId: 'aaaaaaaa-1', summary: 'Older', lastModified: 1, cwd: '/elsewhere' },
    { sessionId: 'bbbbbbbb-2', summary: 'Fix the typo sk-ant-abcdefghijkl', lastModified: 5 },
    { sessionId: 'cccccccc-3', customTitle: 'Newest', lastModified: 9 },
  ]; } });
  t.after(h.close);
  const r = await h.cmd('history');
  assert.equal(seen[0].dir, h.dir);
  assert.deepEqual(r.sessions.map((s) => s.title), ['Newest', 'Fix the typo [hidden secret]']);
  assert.equal((await h.cmd('resume', { sessionId: 'cccccccc-3' })).ok, true);
  assert.equal((await h.next((e) => e.type === 'session')).sessionId, 'cccccccc-3');
});

test('replay gives a reloaded window what it missed, already redacted', async (t) => {
  const h = harness(); t.after(h.close);
  await h.cmd('send', { text: '#leak' });
  await h.next((e) => e.type === 'turn_done');
  const r = await h.cmd('replay');
  assert.ok(r.events.some((e) => e.type === 'turn_done'));
  assert.doesNotMatch(JSON.stringify(r.events), /cdef1234567890/);
  assert.equal(r.events.filter((e) => e.type === 'status').length, 0, 'the hover line is not replayed');
});
