// The usage meter when Claude Code restarts. Two bugs found Nov 26: keeping one total per project
// dropped earlier spend after New chat or a skill reload; then adding each process's total counted
// twice a chat that carries on from the total its transcript saved (Claude Code 2.1.332 does this).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createHelper } from '../engine/helper.mjs';
import { Budget, tokensOf } from '../usage/budget.mjs';
import { KEYCHAIN_SERVICE } from '../engine/options.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';
import { tempProject, collector } from './support.mjs';

const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-9, `${why}: got ${a}, wanted ${b}`);

// n = tokens so far in this process (modelUsage); each turn's own main loop is 500 tokens (usage)
const res = (usd, sessionId, n) => ({ totalCostUsd: usd, sessionId, tokens: tokensOf({ m: { inputTokens: n } }, { input_tokens: 500 }) });

test('budget: a chat that carries on from its saved total is not counted twice (bug found Nov 26)', () => {
  const b = new Budget(5);
  b.record('site#1', res(0.3, 's1', 3000));
  const chat = b.record('site#2', res(0.35, 's1', 3500)); // the new process started from the saved 0.3
  near(b.spent, 0.35, 'only the 0.05 it added counts (this was 0.65 before the fix)');
  near(chat, 0.35, 'and the chat cost');
});

test('budget: a chat that carries on from $0 still keeps its earlier spend', () => {
  const b = new Budget(5);
  b.record('site#1', res(0.3, 's1', 3000));
  const chat = b.record('site#2', res(0.05, 's1', 500)); // the new process started at 0
  near(b.spent, 0.35, 'both parts count');
  near(chat, 0.35, 'the chat cost is both parts');
  b.record('site#2', res(0.08, 's1', 800));
  near(b.spent, 0.38, 'then only what each reply adds');
});

test('budget: a fresh first turn that costs more than the earlier ones is not mistaken for a carried total', () => {
  const b = new Budget(5);
  b.record('site#1', res(0.01, 's1', 1000));
  b.record('site#2', res(0.02, 's1', 1200)); // more dollars and tokens, but only 700 beyond this turn: a fresh start
  near(b.spent, 0.03, 'both parts count');
});

test('budget: the app reopened on a past chat, and a running total that starts over', () => {
  let saved = null; const store = { load: () => saved, save: (v) => { saved = JSON.parse(JSON.stringify(v)); } };
  const first = new Budget(5, { store, today: () => '2026-11-26' });
  first.record('site#1', res(1, 's1', 10000));
  const second = new Budget(5, { store, today: () => '2026-11-26' });
  near(second.chatCost('s1'), 1, 'the chat record survives a restart');
  second.record('site#1', res(1.2, 's1', 12000)); // the reopened chat carried on from its saved $1
  near(second.spent, 1.2, 'today counts the $1 once (this was $2.20 before the fix)');
  second.record('site#1', res(0.1, 's1', 13000)); // a /clear started the running total over
  near(second.spent, 1.3, 'the new total adds on');
  const tomorrow = new Budget(5, { store, today: () => '2026-11-27' });
  tomorrow.record('site#1', res(0.3, 's1', 14000)); // carried on from the 0.1 saved after the /clear
  near(tomorrow.spent, 0.2, "a chat carried over from yesterday counts only today's part");
  near(tomorrow.chatCost('s1'), 1.5, 'the chat keeps its whole cost');
});

for (const restoreCost of [false, true]) test(`end to end (${restoreCost ? 'carried totals' : 'totals from $0'}): New chat and a skill reload keep today's spend and the chat cost right`, async (t) => {
  const dir = tempProject(); const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-home-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });
  const c = collector(); const budget = new Budget(5); let spawns = 0;
  const helper = createHelper({
    projects: [{ name: 'site', path: dir, tag: 'personal' }], sdk: { query }, budget, log: silentLogger, send: c.push,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: [], home, spawn: (o) => { spawns++; return createFakeClaude(o, { restoreCost }); } },
  });
  t.after(() => helper.shutdown());
  const turn = async (text, n) => {
    await helper.handleCommand({ type: 'send', project: 'site', text });
    await c.next((e) => e.type === 'turn_done' && c.of('turn_done').length === n);
    return c.of('usage').at(-1);
  };
  await turn('#hello', 1); const u2 = await turn('#hello', 2);
  near(u2.chatUsd, 0.02, 'two replies'); near(u2.spentUsd, 0.02, 'today so far');

  await helper.handleCommand({ type: 'newChat', project: 'site' });
  const u3 = await turn('#hello', 3);
  assert.equal(spawns, 2);
  near(u3.chatUsd, 0.01, 'the new chat shows only its own cost');
  near(u3.spentUsd, 0.03, 'today still counts the first chat (this was 0.01 before the fix)');

  fs.mkdirSync(path.join(dir, '.claude', 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\n');
  const u4 = await turn('#hello', 4);
  assert.equal(spawns, 3, 'the skill reload restarted Claude Code');
  near(c.of('turn_done').at(-1).costUsd, restoreCost ? 0.02 : 0.01, 'the new process started from the saved total, or from $0');
  near(u4.chatUsd, 0.02, 'the same chat keeps its earlier cost');
  near(u4.spentUsd, 0.04, 'and so does today');
});
