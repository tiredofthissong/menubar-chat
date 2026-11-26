// handoff.test.mjs - big jobs go to Claude Code in Claude's desktop app, on Bromo's subscription,
// with no change to how the app looks (Bromo, Nov 26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { pullHandoff, handoffUrl, isHandoffLink, HANDED, NOT_OPENED } from '../engine/handoff.mjs';
import { createHandoffOpener } from '../app/handoff-open.mjs';
import { looksInside } from '../policy/devmode.mjs';
import { createHelper } from '../engine/helper.mjs';
import { Budget } from '../usage/budget.mjs';
import { KEYCHAIN_SERVICE, buildQueryOptions } from '../engine/options.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';
import { tempProject, collector } from './support.mjs';

test('the "Handoff:" line comes out of the reply; the first one is the request', () => {
  const found = { prompt: null };
  assert.equal(pullHandoff('Big job.\n**Handoff:** "Build the page"\nHandoff: second', found), 'Big job.');
  assert.equal(found.prompt, 'Build the page');
});

test('the link: Claude Desktop\'s Code tab, the request and the project folder, nothing else', () => {
  const url = handoffUrl('Build a page & test it', '/Users/bromo/first-build');
  assert.equal(url, 'claude://code/new?q=Build%20a%20page%20%26%20test%20it&folder=%2FUsers%2Fbromo%2Ffirst-build');
  assert.equal(isHandoffLink(url), true);
  assert.equal(handoffUrl('x', 'first-build'), null, 'a folder must be a full path');
  assert.equal(handoffUrl('x', '/Users/bromo/../etc'), null);
  assert.equal(handoffUrl('  ', '/Users/bromo'), null);
  for (const bad of ['https://example.org', 'claude://claude.ai/new?q=x', 'claude://code/new?q=x&folder=%2Fa&file=y', 'claude-cli://open?q=x', `${url}#x`]) assert.equal(isHandoffLink(bad), false, bad);
});

test('the app opens only an automatic hand-off of the right shape, and says so if the desktop app won\'t open', async () => {
  const opened = []; const sent = [];
  const ok = createHandoffOpener({ shell: { openExternal: async (u) => { opened.push(u); } }, send: (e) => sent.push(e) });
  const url = handoffUrl('Build it', '/p');
  ok({ type: 'handoff', project: 'g', url, auto: true });
  ok({ type: 'handoff', project: 'g', url, auto: false });
  ok({ type: 'handoff', project: 'g', url: 'https://evil.example', auto: true });
  ok({ type: 'text', url, auto: true });
  assert.deepEqual(opened, [url]);
  const fails = createHandoffOpener({ shell: { openExternal: () => Promise.reject(new Error('no app')) }, send: (e) => sent.push(e) });
  fails({ type: 'handoff', project: 'g', url, auto: true });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.length, 1); assert.equal(sent[0].type, 'hint'); assert.match(sent[0].text, /didn't open/);
});

test('Claude here is told which jobs to hand off', () => {
  const o = buildQueryOptions({ mode: 'default', project: { path: '/p', name: 'p' }, canUseTool: () => {}, preToolUseHook: () => {}, keychainService: KEYCHAIN_SERVICE });
  assert.match(o.systemPrompt.append, /Handoff:/);
  assert.match(o.systemPrompt.append, /plan here/, 'planning stays here');
  assert.match(o.systemPrompt.append, /project's own rules describe a build step/, 'a project rule like "wait for build" still hands off (Bromo, Nov 26)');
});

function setup(t) {
  const dir = tempProject(); const c = collector();
  const helper = createHelper({
    projects: [{ name: 'garden', path: dir, tag: 'personal' }], sdk: { query }, budget: new Budget(5), log: silentLogger, send: c.push,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: [], spawn: (o) => createFakeClaude(o) },
  });
  t.after(() => { helper.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  const ask = async (text) => { const n = c.of('turn_done').length + 1; await helper.handleCommand({ type: 'send', project: 'garden', text }); await c.next((e) => e.type === 'turn_done' && c.of('turn_done').length === n); };
  return { c, dir, ask, helper };
}

test('end to end: a big job opens Claude Code with the request; the chat shows one line and no "Handoff:" text', async (t) => {
  const { c, dir, ask } = setup(t);
  await ask('#bigjob');
  const [h] = c.of('handoff');
  assert.equal(h.auto, true); assert.equal(h.line, HANDED);
  assert.equal(h.prompt, 'Build a watering schedule page for the garden app & add tests.');
  assert.equal(h.url, handoffUrl(h.prompt, dir));
  assert.equal(c.of('text').some((e) => /Handoff:/.test(e.text)), false);
  assert.equal(c.of('approval').length, 0);
});

test('end to end: reading this project first still opens it; running a command first does not', async (t) => {
  const { c, ask, helper } = setup(t);
  await helper.handleCommand({ type: 'setMode', project: 'garden', mode: 'dev' }); // both steps go ahead in the folder
  await ask('#bigread');
  assert.equal(c.of('handoff')[0].auto, true, 'Claude looked at a file here to size the job (Bromo, Nov 26)');
  await ask('#bigrun');
  const h = c.of('handoff')[1];
  assert.equal(h.auto, false); assert.equal(h.line, NOT_OPENED);
  await ask('#bigjob');
  assert.equal(c.of('handoff')[2].auto, true, 'the next turn starts fresh');
});

test('hand-off: only reading and searching inside the folder counts as looking', () => {
  const root = '/work/garden';
  assert.equal(looksInside('Read', { file_path: '/work/garden/garden.js' }, root), true);
  assert.equal(looksInside('Grep', { pattern: 'water' }, root), true);
  assert.equal(looksInside('Bash', { command: 'ls -la && cat notes.txt' }, root), true);
  assert.equal(looksInside('Read', { file_path: '/Users/me/.ssh/config' }, root), false);
  assert.equal(looksInside('Bash', { command: 'cat ../other/notes.txt' }, root), false);
  assert.equal(looksInside('Bash', { command: 'npm test' }, root), false);
  assert.equal(looksInside('WebFetch', { url: 'https://example.com' }, root), false);
  assert.equal(looksInside('Write', { file_path: '/work/garden/x.js' }, root), false);
  assert.equal(looksInside('AskUserQuestion', { questions: [] }, root), true, 'questions to you, then a plan, then the hand-off');
});
