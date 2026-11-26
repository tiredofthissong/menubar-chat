import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInit } from '../engine/init-check.mjs';
import { buildQueryOptions, safeEnv, KEYCHAIN_SERVICE, WHY_RULE } from '../engine/options.mjs';
import { explainToolCall, splitSteps } from '../engine/explain.mjs';
import { StatusBoard, MAX_LINE } from '../engine/status.mjs';
import { Budget } from '../engine/budget.mjs';
import { redact, LineBuffer } from '../engine/redact.mjs';
import { createInputQueue } from '../engine/input-queue.mjs';
import { makePreToolUseHook } from '../policy/hook.mjs';
import { MODES, START_MODE, isAllowedMode } from '../policy/modes.mjs';

const project = { name: 'p', path: '/tmp/p', tag: 'work' };
const fn = () => {};

test('init check: only the app key and the asked mode pass', () => {
  assert.equal(checkInit({ apiKeySource: 'apiKeyHelper', permissionMode: 'default' }, 'default').ok, true);
  for (const src of ['none', '/login managed key', 'ANTHROPIC_API_KEY', undefined]) {
    assert.equal(checkInit({ apiKeySource: src, permissionMode: 'default' }, 'default').code, 'wrong-credential');
  }
  assert.equal(checkInit({ apiKeySource: 'apiKeyHelper', permissionMode: 'acceptEdits' }, 'default').code, 'wrong-mode');
  assert.equal(checkInit({ apiKeySource: 'apiKeyHelper', permissionMode: 'bypassPermissions' }, 'default').code, 'wrong-mode');
});

test('modes: only "Ask me first" and "Plan first"', () => {
  assert.deepEqual(Object.keys(MODES), ['default', 'plan']);
  assert.equal(START_MODE, 'default');
  for (const m of ['acceptEdits', 'bypassPermissions', 'dontAsk', 'auto', '', undefined]) assert.equal(isAllowedMode(m), false);
});

test('options: refuses to start without a mode, callback, hook or key name', () => {
  assert.throws(() => buildQueryOptions({ project, mode: 'bypassPermissions', canUseTool: fn, preToolUseHook: fn, keychainService: KEYCHAIN_SERVICE }));
  assert.throws(() => buildQueryOptions({ project, canUseTool: fn, preToolUseHook: fn, keychainService: KEYCHAIN_SERVICE }));
  assert.throws(() => buildQueryOptions({ project, mode: 'default', preToolUseHook: fn, keychainService: KEYCHAIN_SERVICE }));
  assert.throws(() => buildQueryOptions({ project, mode: 'default', canUseTool: fn, keychainService: KEYCHAIN_SERVICE }));
  assert.throws(() => buildQueryOptions({ project, mode: 'default', canUseTool: fn, preToolUseHook: fn, keychainService: 'x; rm -rf ~' }));
});

test('options: the safe shape', () => {
  const o = buildQueryOptions({ project, mode: 'default', canUseTool: fn, preToolUseHook: fn, keychainService: KEYCHAIN_SERVICE, budgetUsd: 4.5 });
  assert.equal(o.permissionMode, 'default');
  assert.equal(o.allowedTools, undefined);
  assert.equal(o.allowDangerouslySkipPermissions, undefined);
  assert.equal(o.hooks.PreToolUse[0].onFailure, 'block');
  assert.equal(o.settings.apiKeyHelper, `/usr/bin/security find-generic-password -s ${KEYCHAIN_SERVICE} -w`);
  assert.equal(o.systemPrompt.append, WHY_RULE);
  assert.equal(o.maxBudgetUsd, 4.5);
  assert.equal(o.model, 'sonnet', 'always Sonnet unless told otherwise, never Claude Code\'s Opus default');
  assert.ok(o.disallowedTools.includes('Bash(git push *)'));
});

test('env allowlist: no API key or token from the app reaches Claude Code', () => {
  const env = safeEnv({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'sk-ant-x', GITHUB_TOKEN: 'ghp_x', AWS_SECRET_ACCESS_KEY: 'x', CLAUDE_CODE_OAUTH_TOKEN: 'x' });
  assert.equal(env.PATH, '/bin');
  for (const k of ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) assert.equal(env[k], undefined, k);
});

test('explain: a chain names every step, and rm is flagged', () => {
  const ex = explainToolCall('Bash', { command: 'git pull && mkdir -p a && cp x a/' }, '/tmp');
  assert.equal(ex.steps.length, 3);
  assert.match(ex.plain, /^Run 3 steps: download the latest changes; make a folder; copy files\.$/);
  assert.equal(ex.danger, false);
  assert.equal(explainToolCall('Bash', { command: 'ls && rm -rf build' }).danger, true);
  assert.deepEqual(splitSteps('a; b || c\nd'), ['a', 'b', 'c', 'd']);
  assert.match(explainToolCall('Edit', { file_path: '/tmp/p/notes.txt' }, '/tmp/p').plain, /notes\.txt/);
});

test('explain: a shell loop lists its real steps, not its keywords', () => {
  const ex = explainToolCall('Bash', { command: 'cd ~/x; ls; for d in */; do if [ -d "$d/.git" ]; then echo "$d"; fi; done; echo end' });
  assert.equal(ex.plain, 'Run 6 steps: go into a folder; list files; repeat for each item; check a condition; print text; print text.');
  assert.ok(!ex.steps.some((s) => /^(do|done|then|fi)$/.test(s)));
  const del = explainToolCall('Bash', { command: 'while read l; do rm "$l"; done < list.txt' });
  assert.equal(del.danger, true, 'an rm inside a loop is still flagged');
  assert.match(del.plain, /DELETE files/);
});

test('status line: short, no secrets, sticky while a card is open, counts other busy projects', () => {
  const s = new StatusBoard();
  assert.equal(s.top().line, 'Ready');
  s.set('a', 'working', 'x'.repeat(300) + ' sk-ant-abcdefabcdef123456');
  assert.ok(s.top().line.length <= MAX_LINE + 1);
  assert.doesNotMatch(s.top().line, /sk-ant-/);
  s.setPendingCards('a', 1);
  s.set('a', 'working', 'still going');
  assert.equal(s.top().state, 'waiting');
  s.set('b', 'thinking');
  assert.match(s.top().line, /^Waiting on you · a.*\(\+1 more\)$/);
  s.setPendingCards('a', 0);
  assert.equal(s.top().state, 'working');
});

test('budget: adds up per project and stops at the cap', () => {
  const b = new Budget(5);
  b.record('a', 1.2); b.record('a', 2); b.record('b', 2.5); b.record('c', -1); b.record('d', 'x');
  assert.equal(b.spent, 4.5); assert.equal(b.left, 0.5); assert.equal(b.reached, false);
  b.record('b', 3); assert.equal(b.reached, true); assert.equal(b.left, 0);
});

test('budget: the cap is per day and survives a restart', () => {
  let saved = null; let day = '2026-11-26';
  const store = { load: () => saved, save: (v) => { saved = v; } };
  const first = new Budget(5, { store, today: () => day });
  first.record('a', 1.5); first.record('b', 1);
  assert.deepEqual(saved, { day: '2026-11-26', spent: 2.5 });
  const second = new Budget(5, { store, today: () => day }); // the app was quit and reopened
  assert.equal(second.spent, 2.5, 'earlier spend today still counts');
  second.record('a', 2.6);
  assert.equal(second.reached, true, '2.5 earlier + 2.6 now is past $5');
  day = '2026-11-27';
  assert.equal(second.spent, 0, 'a new day starts over');
  assert.equal(second.reached, false);
  second.record('a', 3.1); // the same session spends 0.5 more after midnight
  assert.equal(second.spent, 0.5);
  const nextDay = new Budget(5, { store: { load: () => ({ day: '2026-11-25', spent: 4 }), save() {} }, today: () => '2026-11-26' });
  assert.equal(nextDay.spent, 0, "yesterday's file doesn't count today");
  const broken = new Budget(5, { store: { load: () => { throw new Error('no file'); }, save() { throw new Error('read-only'); } } });
  broken.record('a', 1); assert.equal(broken.spent, 1, 'a missing or unwritable file never breaks the meter');
});

test('redact: keys and tokens never show, even split across chunks', () => {
  for (const s of ['sk-ant-api03-abcdefghijklmnop', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'AKIAABCDEFGHIJKLMNOP', 'xoxb-1234-5678-abcdef']) {
    assert.doesNotMatch(redact(`key ${s} end`), new RegExp(s.slice(0, 8)));
  }
  const lb = new LineBuffer();
  assert.equal(lb.push('Your key is sk-ant-ab'), '');
  const out = lb.push('cdef1234567890 ok\n');
  assert.doesNotMatch(out, /cdef1234567890/);
  assert.match(out, /ok/);
});

test('input queue delivers in order and ends', async () => {
  const q = createInputQueue();
  q.push(1); q.push(2); setTimeout(() => { q.push(3); q.end(); }, 5);
  const got = []; for await (const v of q) got.push(v);
  assert.deepEqual(got, [1, 2, 3]);
});

test('hook: denies hard-rule calls in the SDK shape and passes the rest on', async () => {
  const blocked = [];
  const hook = makePreToolUseHook({ project, onBlocked: (r) => blocked.push(r) });
  const out = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push' } });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.deepEqual(blocked, ['work-publish']);
  assert.deepEqual(await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }), {});
  assert.deepEqual(await hook({ hook_event_name: 'PostToolUse' }), {});
});
