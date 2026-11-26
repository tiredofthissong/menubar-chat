// The usage meter when Claude Code restarts (bug found Nov 26, while Bromo asked how accurate it is):
// each Claude Code process reports its own running total from $0, so keeping one total per
// project dropped that project's earlier spend after New chat, a past chat or a skill reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createHelper } from '../engine/helper.mjs';
import { Budget } from '../usage/budget.mjs';
import { createMeter } from '../usage/meter.mjs';
import { KEYCHAIN_SERVICE } from '../engine/options.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';
import { tempProject, collector } from './support.mjs';

const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-9, `${why}: got ${a}, wanted ${b}`);

test('meter: a chat that moves to a fresh Claude Code keeps what it had cost', () => {
  const m = createMeter();
  m.onResult({ totalCostUsd: 0.3 });
  m.newProcess(); m.onResult({ totalCostUsd: 0.05 });
  near(m.snapshot().chatUsd, 0.35, 'the new process starts its total at 0');
  m.newProcess(); m.onResult({ totalCostUsd: 0.1 });
  near(m.snapshot().chatUsd, 0.45, 'twice');
  m.reset(); m.newProcess(); m.onResult({ totalCostUsd: 0.02 });
  near(m.snapshot().chatUsd, 0.02, 'a new chat starts over');
});

test('budget: each Claude Code run counts on its own, so a restart drops nothing', () => {
  const b = new Budget(5);
  b.record('site#1', 1.2); b.record('site#2', 0.4); b.record('site#1', 1.5); b.record('other#1', 1);
  near(b.spent, 2.9, 'site#1 latest 1.5 + site#2 0.4 + other 1');
});

test('end to end: New chat and a skill reload keep today\'s spend and the chat cost right', async (t) => {
  const dir = tempProject(); const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-home-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });
  const c = collector(); const budget = new Budget(5); let spawns = 0;
  const helper = createHelper({
    projects: [{ name: 'site', path: dir, tag: 'personal' }], sdk: { query }, budget, log: silentLogger, send: c.push,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: [], home, spawn: (o) => { spawns++; return createFakeClaude(o); } },
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
  near(u4.chatUsd, 0.02, 'the same chat keeps its earlier cost');
  near(u4.spentUsd, 0.04, 'and so does today');
});
