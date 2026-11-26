// Every approval card in one shape (Bromo, Nov 26: cards named each action by its tool name but
// didn't say clearly what was asked and why, the same way every time, without getting annoying).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { describeTool, commandEffect, EFFECTS } from '../shared/describe.mjs';
import { explainToolCall } from '../shared/explain.mjs';
import { createHelper } from '../engine/helper.mjs';
import { Budget } from '../usage/budget.mjs';
import { KEYCHAIN_SERVICE, WHY_RULE } from '../engine/options.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';
import { tempProject, collector } from './support.mjs';

const TOOLS = [['Edit', { file_path: '/p/a.js' }], ['Write', { file_path: '/p/b.md' }], ['NotebookEdit', { notebook_path: '/p/n.ipynb' }],
  ['Read', { file_path: '/p/a.js' }], ['Glob', { pattern: '**/*.js' }], ['Grep', { pattern: 'water' }], ['WebFetch', { url: 'https://example.org/x' }],
  ['WebSearch', { query: 'shade plants' }], ['Agent', { description: 'look for tests' }], ['Task', { description: 'x' }], ['Skill', { skill: 'pdf' }],
  ['TodoWrite', {}], ['BashOutput', {}], ['KillShell', {}], ['ExitPlanMode', {}], ['mcp__github__create_issue', {}]];

test('every card says what Claude wants in plain words, with a kind from one fixed list', () => {
  for (const [t, i] of [...TOOLS, ['Bash', { command: 'ls' }], ['Bash', { command: 'a && b' }]]) {
    const ex = explainToolCall(t, i, '/p');
    assert.ok(ex.what && !ex.what.includes(t) && !/^[A-Z]/.test(ex.what), `${t}: "${ex.what}" reads as plain words after "Claude wants to"`);
    assert.ok(EFFECTS[ex.effect], t); assert.equal(ex.kindLabel, EFFECTS[ex.effect], t);
    assert.equal(typeof ex.where, 'string'); assert.equal(typeof ex.reason, 'string');
  }
  assert.equal(describeTool('mcp__github__create_issue').what, 'use "create issue" in github');
  assert.match(describeTool('Mystery').what, /doesn't know/, 'an unknown tool says so instead of pretending');
  assert.equal(describeTool('Agent', { description: 'look for tests' }).reason, 'look for tests', "a tool's own reason is kept");
  assert.equal(explainToolCall('Bash', { command: 'npm install', description: 'Install packages for the garden' }).reason, 'Install packages for the garden');
  assert.equal(explainToolCall('Bash', { command: 'cat a', description: 'key sk-ant-abcdefghijklmnopqrst' }).reason.includes('abcdefghij'), false, 'redacted');
});

test('a command\'s kind: only looks, uses the internet, deletes, or runs a program', () => {
  assert.equal(commandEffect(['ls', 'cat a.txt', 'git status']), 'looks');
  assert.equal(commandEffect(['echo hi > out.txt']), 'runs', 'writing a file is not only looking');
  assert.equal(commandEffect(['npm install']), 'internet');
  assert.equal(commandEffect(['git pull', 'ls']), 'internet');
  assert.equal(commandEffect(['npm test']), 'runs');
  assert.equal(commandEffect(['ls'], true), 'deletes');
  assert.match(WHY_RULE, /command, web lookup/, 'Claude is asked for a Why: line before every kind of step');
});

function harness(t) {
  const dir = tempProject(); const c = collector();
  const helper = createHelper({
    projects: [{ name: 'garden', path: dir, tag: 'personal' }], sdk: { query }, budget: new Budget(5), log: silentLogger, send: c.push,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: [], spawn: (o) => createFakeClaude(o) },
  });
  t.after(() => { helper.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  const ask = async (text, n) => {
    await helper.handleCommand({ type: 'send', project: 'garden', text });
    const card = (await c.next((e) => e.type === 'approval' && c.of('approval').length === n)).card;
    await helper.handleCommand({ type: 'answer', project: 'garden', id: card.id, decision: 'deny' });
    await c.next((e) => e.type === 'turn_done' && c.of('turn_done').length === n);
    return card;
  };
  return { ask };
}

test('end to end: the card carries Claude\'s own Why: line, or the command\'s own reason', async (t) => {
  const h = harness(t);
  const web = await h.ask('#web', 1);
  assert.equal(web.what, 'open a web page on example.org'); assert.equal(web.kindLabel, 'Uses the internet');
  assert.equal(web.reason, 'you asked which plants need shade.', 'Claude\'s Why: line wins over the tool\'s own prompt');
  const edit = await h.ask('#edit', 2);
  assert.equal(edit.reason, 'notes.txt has a typo.'); assert.equal(edit.kindLabel, 'Changes files');
  assert.equal(edit.learn.line.length > 0, true);
  const npm = await h.ask('#npm', 3);
  assert.equal(npm.reason, 'Install the garden app packages'); assert.equal(npm.what, 'run a command to install packages');
  const nowhy = await h.ask('#nowhy', 4);
  assert.equal(nowhy.reason, ''); assert.equal(nowhy.learn.line, 'More on this kind of step:', 'the second edit card skips the plain line');
});

test('window: one shape for every card, and an honest line when Claude gave no reason', () => {
  const src = fs.readFileSync(new URL('../app/window/cards.js', import.meta.url), 'utf8');
  assert.match(src, /`Claude wants to \$\{card\.what\}/);
  assert.match(src, /Why: Claude didn\\'t say\. If that matters, Deny and ask\./);
  assert.match(src, /card\.kindLabel/);
  assert.doesNotMatch(src, /Use \$\{card\.toolName\}\.`\)\)\);\n\s*if \(list\)/, 'no bare tool name as the first line');
});
