// Bromo's Dev mode check (Nov 26). Prompt 2 ("read the files in this project") asked when it
// shouldn't, prompt 8 ("list the folder that holds this project") ran with no card, and he asked
// that an allowed web lookup "remain allow until the app is quit or 60 minutes".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { devModeAllows, looksOutside } from '../policy/devmode.mjs';
import { createWebPass, webPassAllows } from '../policy/webpass.mjs';
import { ApprovalBroker } from '../policy/approvals.mjs';
import { OUTSIDE_LABEL } from '../engine/permit.mjs';
import { explainToolCall } from '../shared/explain.mjs';
import { createHelper } from '../engine/helper.mjs';
import { Budget } from '../usage/budget.mjs';
import { KEYCHAIN_SERVICE, buildQueryOptions } from '../engine/options.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';
import { tempProject, collector } from './support.mjs';

const root = tempProject();
const card = (t, i) => explainToolCall(t, i, root);
const go = (c) => devModeAllows('Bash', { command: c }, root, card('Bash', { command: c }));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('reading the project the ways Claude does goes ahead, quoted words included', () => {
  for (const c of ['ls -la', "find . -type f -not -path './.git/*' | head -50", 'for f in *.json *.md; do echo "=== $f ==="; head -40 "$f"; done',
    'wc -l * 2>/dev/null', 'echo "=== open questions ===" && grep -n "TODO" notes.txt', 'grep -rn "sudo" .', 'python3 -m json.tool plants.json',
    'cat plants.json | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"', `ls -la ${root} && cat ${root}/notes.txt`,
    'ls -la && echo "---" && cat README.md 2>/dev/null || echo "no readme"', 'node -e "console.log(require(\'./plants.json\').length)"',
    // His second card (Nov 26): a loop over $(find ...) that skips node_modules.
    `for f in $(find . -type f -not -path './node_modules/*' -not -path './.git/*'); do echo "=== $f ==="; head -50 "$f"; done`,
    'for f in $(git ls-files); do wc -l "$f"; done', 'cat $(find . -name "*.json")']) assert.equal(go(c), true, c);
});

test('quotes, backslashes and typed-in code cannot hide a step that should ask', () => {
  for (const c of ['"sudo" ls', 'echo hi; "rm" x', 'su\\do ls', 'bash -c "ls"', 'echo x | python3', 'env ls', "cat '../x'", 'cat a/../../x',
    'cat "/etc/passwd"', 'cat "$HOME/x"', `python3 -c "import os; os.system('ls')"`, `node -e "require('child_process').exec('x')"`,
    `python3 -c "import shutil; shutil.rmtree('x')"`, 'python3 -c "import urllib.request"', "$'\\163udo' ls", 'X=1 "sudo" ls', "ls; 'rm' x",
    'for f in $(find / -name x); do cat "$f"; done', 'echo $(rm x)', 'echo $(whoami)', 'echo $(find ..)', 'ls "$(dirname "$PWD")"']) assert.equal(go(c), false, c);
});

test('a look outside the folder is spotted, for commands and for Read, Glob and Grep', () => {
  for (const [t, i] of [['Bash', { command: 'ls ..' }], ['Bash', { command: 'ls /Users' }], ['Bash', { command: 'cd .. && ls' }], ['Bash', { command: 'ls -la ~/' }],
    ['Bash', { command: 'find / -maxdepth 1' }], ['Read', { file_path: '/etc/hosts' }], ['Glob', { pattern: '/Users/**/*.md' }], ['Grep', { pattern: 'x', path: '/' }]]) {
    assert.equal(looksOutside(t, i, root, card(t, i)), true, JSON.stringify(i));
  }
  for (const [t, i] of [['Bash', { command: 'ls -la' }], ['Read', { file_path: 'notes.txt' }], ['Glob', { pattern: '**/*.md' }], ['Grep', { pattern: 'x' }],
    ['Bash', { command: 'rm ../x' }], ['Bash', { command: 'npm install' }]]) {
    assert.equal(looksOutside(t, i, root, card(t, i)), false, `${JSON.stringify(i)}: not a look, so the normal card handles it`);
  }
});

test('the web pass: an hour, Dev mode only, web lookups only, and only on a card that offers it', () => {
  let now = 1_000; const pass = createWebPass({ now: () => now });
  assert.equal(webPassAllows('dev', 'WebFetch', pass), false);
  pass.grant(); assert.equal(webPassAllows('dev', 'WebSearch', pass), true);
  assert.equal(webPassAllows('default', 'WebFetch', pass), false, 'not in Ask me first');
  assert.equal(webPassAllows('dev', 'Bash', pass), false, 'installs and downloads still ask');
  now += 60 * 60 * 1000; assert.equal(webPassAllows('dev', 'WebFetch', pass), false, 'ends at the hour');
  let hours = 0; const b = new ApprovalBroker({ onOpen: () => {}, onClose: () => {}, onHour: () => { hours++; return 'ok'; }, timeoutMs: 0 });
  const plain = b.ask('Bash', {}, {}, {}); b.answer([...b.pending.keys()][0], 'allow_hour');
  return plain.then((r) => { assert.equal(r.behavior, 'deny', 'allow_hour on a card without the button is a no'); assert.equal(hours, 0); });
});

test('the hook waits as long as a card does', () => {
  const o = buildQueryOptions({ mode: 'default', project: { path: root, name: 'p' }, canUseTool: () => {}, preToolUseHook: () => {}, keychainService: KEYCHAIN_SERVICE, hookTimeoutSec: 930 });
  assert.equal(o.hooks.PreToolUse[0].timeout, 930); assert.equal(o.hooks.PreToolUse[0].onFailure, 'block');
});

function setup(t, clock) {
  const dir = tempProject(); const c = collector();
  const helper = createHelper({
    projects: [{ name: 'garden', path: dir, tag: 'personal' }], sdk: { query }, budget: new Budget(5), log: silentLogger, send: c.push,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: [], spawn: (o) => createFakeClaude(o), now: clock },
  });
  t.after(() => { helper.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  const turn = async (text) => { const n = c.of('turn_done').length + 1; await helper.handleCommand({ type: 'send', project: 'garden', text }); return n; };
  const done = (n) => c.next((e) => e.type === 'turn_done' && c.of('turn_done').length === n);
  return { c, helper, turn, done };
}

test('end to end: a look outside the folder gets a card even though Claude Code would run it; a look inside does not', async (t) => {
  const { c, helper, turn, done } = setup(t);
  await done(await turn('#lookhere'));
  assert.equal(c.of('approval').length, 0, 'ls -la in the folder: no card');
  const n = await turn('#peek');
  const ask = (await c.next((e) => e.type === 'approval')).card;
  assert.equal(ask.kindLabel, OUTSIDE_LABEL); assert.match(ask.reason, /next to this project/, 'with Claude\'s "Why:" line');
  await helper.handleCommand({ type: 'answer', project: 'garden', id: ask.id, decision: 'deny' });
  await done(n);
  assert.equal(c.of('tool_failed').length, 0, 'the no is said once, on the card');
  const m = await turn('#peek');
  const yes = (await c.next((e) => e.type === 'approval' && e.card.id !== ask.id)).card;
  await helper.handleCommand({ type: 'answer', project: 'garden', id: yes.id, decision: 'allow' });
  await done(m);
  assert.equal(c.of('approval').length, 2, 'your Allow on the hook\'s card is the only card: no second one');
  assert.equal(c.of('tool_failed').length, 0, 'and the look ran');
});

test('end to end, Dev mode: quoted words go ahead; Allow for an hour covers later web lookups until the hour ends', async (t) => {
  let now = 5_000_000; const { c, helper, turn, done } = setup(t, () => now);
  await helper.handleCommand({ type: 'setMode', project: 'garden', mode: 'dev' });
  await done(await turn('#quoted'));
  assert.equal(c.of('approval').length, 0, 'echo "=== open questions ===" && cat notes.txt: no card');
  let n = await turn('#web');
  const web = (await c.next((e) => e.type === 'approval')).card;
  assert.equal(web.hour, true, 'the web card offers Allow for an hour');
  await helper.handleCommand({ type: 'answer', project: 'garden', id: web.id, decision: 'allow_hour' });
  assert.match((await c.next((e) => e.type === 'approval_closed')).why, /without asking until/);
  await done(n);
  await done(await turn('#web'));
  assert.equal(c.of('approval').length, 1, 'the second lookup went ahead on the pass');
  // Switching mode ends the pass, so the next lookup asks again (checked below, after the switch).
  await helper.handleCommand({ type: 'setMode', project: 'garden', mode: 'default' });
  await helper.handleCommand({ type: 'setMode', project: 'garden', mode: 'dev' });
  n = await turn('#web');
  const fresh = (await c.next((e) => e.type === 'approval' && e.card.id !== web.id)).card;
  await helper.handleCommand({ type: 'answer', project: 'garden', id: fresh.id, decision: 'allow_hour' });
  await done(n);
  now += 61 * 60 * 1000; n = await turn('#web');
  const again = (await c.next((e) => e.type === 'approval' && ![web.id, fresh.id].includes(e.card.id))).card;
  await helper.handleCommand({ type: 'answer', project: 'garden', id: again.id, decision: 'deny' });
  await done(n);
});
