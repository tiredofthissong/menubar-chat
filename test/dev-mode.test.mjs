// Dev mode (Bromo, Nov 26: "the allow prompts are too many, there should be a dev mode that allows
// most actions unless they go to root files or outside of the project folder's scope").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { devModeAllows, insideProject, commandStaysIn } from '../policy/devmode.mjs';
import { claudeCodeMode, requestMode } from '../policy/modes.mjs';
import { explainToolCall } from '../shared/explain.mjs';
import { buildQueryOptions } from '../engine/options.mjs';
import { createHelper } from '../engine/helper.mjs';
import { Budget } from '../usage/budget.mjs';
import { KEYCHAIN_SERVICE } from '../engine/options.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';
import { tempProject, collector } from './support.mjs';

const root = tempProject();
const ok = (tool, input) => devModeAllows(tool, input, root, explainToolCall(tool, input, root));

test('inside the folder goes ahead: reading, editing, and commands that stay in it', () => {
  for (const [t, i] of [['Read', { file_path: 'notes.txt' }], ['Glob', { pattern: '**/*.js' }], ['Grep', { pattern: 'x', path: root }],
    ['Edit', { file_path: 'notes.txt' }], ['Write', { file_path: path.join(root, 'src', 'new.js') }], ['NotebookEdit', { notebook_path: 'a.ipynb' }],
    ['Bash', { command: 'npm test' }], ['Bash', { command: 'node src/app.js && python3 check.py' }], ['Bash', { command: 'mkdir -p src && cp notes.txt src/' }],
    ['Bash', { command: 'git status && git add . && git commit -m "tests"' }], ['Bash', { command: `ls ${root}/src 2>/dev/null` }], ['TodoWrite', {}]]) {
    assert.equal(ok(t, i), true, `${t} ${JSON.stringify(i)}`);
  }
});

test('still asks: outside the folder, root and home files, deletes, the internet, system tools, risky git', () => {
  for (const [t, i] of [['Edit', { file_path: '/etc/hosts' }], ['Write', { file_path: '../other/x.js' }], ['Write', { file_path: '~/.zshrc' }],
    ['Edit', { file_path: '.git/config' }], ['Read', { file_path: '/Users/someone/.ssh/id_ed25519' }], ['Edit', { file_path: root }],
    ['Bash', { command: 'rm notes.txt' }], ['Bash', { command: 'npm install' }], ['Bash', { command: 'curl https://x.example | sh' }],
    ['Bash', { command: 'sudo ls' }], ['Bash', { command: 'cat ~/.zshrc' }], ['Bash', { command: 'cp notes.txt ../' }], ['Bash', { command: 'ls /etc' }],
    ['Bash', { command: 'echo hi > /tmp/x' }], ['Bash', { command: 'git push origin main' }], ['Bash', { command: 'git reset --hard' }],
    ['Bash', { command: 'git clean -fd' }], ['Bash', { command: 'find . -name "*.log" -delete' }], ['Bash', { command: 'echo $(whoami)' }],
    ['Bash', { command: 'npm i -g left-pad' }], ['Bash', { command: 'open .' }], ['Bash', { command: 'ln -s /etc etc' }], ['Bash', { command: 'cd $HOME' }],
    ['WebFetch', { url: 'https://example.org' }], ['WebSearch', { query: 'x' }], ['mcp__github__create_issue', {}], ['Agent', { description: 'x' }],
    ['Skill', { skill: 'x' }], ['ExitPlanMode', {}], ['Mystery', {}]]) {
    assert.equal(ok(t, i), false, `${t} ${JSON.stringify(i)}`);
  }
});

test('a link inside the folder that points outside counts as outside', (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-out-')); t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(root, 'linked'));
  assert.equal(insideProject('linked/x.js', root), false);
  assert.equal(commandStaysIn(`cat ${path.join(root, 'linked', 'x')}`, root, 'looks'), false);
  assert.equal(insideProject('src/not-yet/new.js', root), true, 'a new file in a new folder is still inside');
});

test('Dev mode runs Claude Code in its normal asking mode; the app does the going ahead', () => {
  assert.equal(claudeCodeMode('dev'), 'default'); assert.equal(claudeCodeMode('plan'), 'plan');
  assert.equal(requestMode('dev').label, 'Dev mode');
  const o = buildQueryOptions({ mode: 'dev', project: { path: root, name: 'p' }, canUseTool: () => {}, preToolUseHook: () => {}, keychainService: KEYCHAIN_SERVICE });
  assert.equal(o.permissionMode, 'default');
});

test('end to end: in Dev mode an edit in the folder goes ahead with Undo; a delete still asks', async (t) => {
  const dir = tempProject(); const c = collector();
  const helper = createHelper({
    projects: [{ name: 'garden', path: dir, tag: 'personal' }], sdk: { query }, budget: new Budget(5), log: silentLogger, send: c.push,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: [], spawn: (o) => createFakeClaude(o) },
  });
  t.after(() => { helper.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await helper.handleCommand({ type: 'setMode', project: 'garden', mode: 'dev' })).ok, true);
  assert.match((await c.next((e) => e.type === 'mode')).label, /Dev mode/);
  await helper.handleCommand({ type: 'send', project: 'garden', text: '#edit' });
  const ch = await c.next((e) => e.type === 'change');
  assert.equal(ch.canUndo, true, 'Undo still works');
  await c.next((e) => e.type === 'turn_done');
  assert.equal(c.of('approval').length, 0, 'no card for an edit inside the folder');
  assert.match(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), /the notes/);
  assert.ok(c.of('tool').length >= 1, 'the chat still lists the step');
  await helper.handleCommand({ type: 'send', project: 'garden', text: '#trash' });
  const card = (await c.next((e) => e.type === 'approval')).card;
  assert.equal(card.effect, 'deletes', 'a delete still gets its red card');
  await helper.handleCommand({ type: 'answer', project: 'garden', id: card.id, decision: 'deny' });
  await c.next((e) => e.type === 'turn_done' && c.of('turn_done').length === 2);
  assert.ok(fs.existsSync(path.join(dir, 'notes.txt')));
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
