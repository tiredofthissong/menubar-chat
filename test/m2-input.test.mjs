// Milestone 2: what you type is sorted before it reaches Claude, and delete cards offer Move to Trash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { classifyInput, looksLikeShell, editDistance } from '../shared/input.mjs';
import { ApprovalBroker, TRASH_INSTEAD } from '../policy/approvals.mjs';
import { createHelper } from '../engine/helper.mjs';
import { Budget } from '../usage/budget.mjs';
import { KEYCHAIN_SERVICE } from '../engine/options.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';
import { tempProject, collector } from './support.mjs';

const cmds = { commands: ['design-rules', 'review', 'init'], project: 'personal-demo' };

test('requests in words go to Claude unchanged', () => {
  for (const t of ['fix the typo in notes.txt', 'git is confusing, can you explain it?', 'open the latest notes please', 'cat facts?']) {
    const c = classifyInput(t, cmds);
    assert.equal(c.kind, 'prompt', t); assert.equal(c.send, t); assert.equal(c.note, '');
  }
});

test('pasted Terminal lines become one command that Claude runs after you allow it', () => {
  const c = classifyInput('git pull\nnpm install', cmds);
  assert.equal(c.kind, 'shell');
  assert.equal(c.command, 'git pull && npm install');
  assert.match(c.send, /^Run exactly this as one command/);
  assert.match(c.send, /```\ngit pull && npm install\n```/);
  assert.match(c.note, /No Terminal needed/);
  for (const t of ['ls', 'cd ~/code', 'npm test', 'mkdir -p a/b && cp x a/b/']) assert.equal(looksLikeShell(t), true, t);
  for (const t of ['git is confusing', 'open the file for me', 'rm what?', 'echo the same thing back to me']) assert.equal(looksLikeShell(t), false, t);
  assert.equal(classifyInput('git pull\nplease explain this', cmds).kind, 'prompt', 'a mix of words and commands is a request');
});

test('"claude ..." and "!" or "$" are trimmed with a calm line', () => {
  let c = classifyInput('claude /design-rules', cmds);
  assert.equal(c.kind, 'slash'); assert.equal(c.send, '/design-rules'); assert.match(c.note, /No need to type "claude"/);
  c = classifyInput('claude "fix the readme"', cmds);
  assert.equal(c.send, 'fix the readme');
  c = classifyInput('!ls', cmds);
  assert.equal(c.kind, 'shell'); assert.match(c.note, /No "!" or "\$" needed/);
  c = classifyInput('$ git status', cmds);
  assert.equal(c.command, 'git status');
  assert.equal(classifyInput('claude', cmds).kind, 'empty');
});

test('slash commands: known ones go through, typos get "Did you mean", the rest get one line', () => {
  assert.deepEqual(classifyInput('/review src', cmds), { kind: 'slash', send: '/review src', note: '' });
  const typo = classifyInput('/desgin-rules', cmds);
  assert.equal(typo.kind, 'slash-typo'); assert.equal(typo.send, null); assert.equal(typo.suggestion, 'design-rules');
  assert.equal(typo.note, "There's no /desgin-rules in personal-demo. Did you mean /design-rules?");
  const none = classifyInput('/banana', cmds);
  assert.equal(none.kind, 'slash-unknown'); assert.equal(none.send, null); assert.match(none.note, /Some that are: \/design-rules, \/review, \/init/);
  const clear = classifyInput('/clear', cmds);
  assert.equal(clear.kind, 'slash-app'); assert.equal(clear.action, 'newChat'); assert.equal(clear.send, null);
  for (const n of ['cost', 'usage', 'model', 'permissions', 'login', 'exit']) assert.equal(classifyInput(`/${n}`, cmds).kind, 'slash-app', n);
  assert.equal(classifyInput('/theme', cmds).kind, 'slash-terminal');
  assert.equal(classifyInput('/banana', { commands: null }).kind, 'slash', 'before Claude Code lists its commands, it decides');
  assert.equal(classifyInput('/Users/bromo/notes.txt is it there?', cmds).kind, 'prompt', 'a file path is not a command');
  assert.equal(editDistance('desgin', 'design'), 2);
});

test('secrets in a pasted command are hidden in what the window shows', () => {
  const c = classifyInput('export_it ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnop', cmds);
  assert.equal(c.kind, 'prompt', 'export is not on the pasted-command list');
  const curl = classifyInput('curl -H "Authorization: Bearer abcdefghijklmnopqrstuv" https://x.test', cmds);
  assert.equal(curl.kind, 'shell');
  assert.doesNotMatch(curl.command, /abcdefghijklmnopqrstuv/);
});

test('Move to Trash is a "no": the rm never runs, and Claude is told to move the files instead', async () => {
  const opened = []; const b = new ApprovalBroker({ onOpen: (c) => opened.push(c), onClose: () => {} });
  const p = b.ask('Bash', { command: 'rm a.txt' }, {}, { danger: true });
  assert.equal(opened[0].trash, true);
  assert.equal(opened[0].defaultChoice, 'deny');
  b.answer(opened[0].id, 'trash');
  const r = await p;
  assert.equal(r.behavior, 'deny');
  assert.equal(r.message, TRASH_INSTEAD);
  assert.match(r.message, /~\/\.Trash\/ with mv -n/);
  // On a card that is not a delete, "trash" is just a no.
  const q = b.ask('Bash', { command: 'ls' }, {}, { danger: false });
  assert.equal(opened[1].trash, false);
  b.answer(opened[1].id, 'trash');
  assert.equal((await q).message, 'You said no, so it was not run.');
});

function harness() {
  const c = collector(); const dir = tempProject(); const name = 'personal-demo';
  const helper = createHelper({
    projects: [{ name, path: dir, tag: 'personal' }], sdk: { query }, budget: new Budget(5), log: silentLogger, send: c.push,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: ['~/claude-hub'], spawn: (o) => createFakeClaude(o) },
  });
  const cmd = (type, f = {}) => helper.handleCommand({ type, project: name, ...f });
  return { ...c, cmd, dir, close: () => { helper.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('end to end: a pasted line gets one card that names every step', async (t) => {
  const h = harness(); t.after(h.close);
  await h.cmd('send', { text: 'git pull\nmkdir -p notes/old' });
  const hint = await h.next((e) => e.type === 'hint');
  assert.equal(hint.kind, 'shell');
  const ap = await h.next((e) => e.type === 'approval');
  assert.equal(ap.card.command, 'git pull && mkdir -p notes/old');
  assert.deepEqual(ap.card.items.map((i) => i.say), ['Download the latest changes', 'Make a folder']);
  assert.equal(ap.card.items[1].target, 'notes/old');
  await h.cmd('answer', { id: ap.card.id, decision: 'deny' });
  await h.next((e) => e.type === 'turn_done');
});

test('end to end: Move to Trash on a delete card; the file is untouched and the window gets a short reason', async (t) => {
  const h = harness(); t.after(h.close);
  fs.writeFileSync(path.join(h.dir, 'old-notes.txt'), 'keep me');
  await h.cmd('send', { text: '#trash' });
  const ap = await h.next((e) => e.type === 'approval');
  assert.equal(ap.card.danger, true); assert.equal(ap.card.trash, true);
  await h.cmd('answer', { id: ap.card.id, decision: 'trash' });
  const closed = await h.next((e) => e.type === 'approval_closed');
  assert.deepEqual([closed.decision, closed.why], ['deny', 'You chose Move to Trash instead.']);
  await h.next((e) => e.type === 'turn_done');
  assert.equal(fs.readFileSync(path.join(h.dir, 'old-notes.txt'), 'utf8'), 'keep me');
  assert.equal(h.of('tool_failed').length, 0, 'the "no" is said once, on the card');
});

test('end to end: /clear starts a fresh chat and sends nothing', async (t) => {
  const h = harness(); t.after(h.close);
  await h.cmd('send', { text: '#hello' });
  await h.next((e) => e.type === 'turn_done');
  await h.cmd('send', { text: '/clear' });
  const s = await h.next((e) => e.type === 'session' && e.sessionId === null);
  assert.equal(s.mode, 'default');
  assert.equal(h.of('turn_done').length, 1);
});
