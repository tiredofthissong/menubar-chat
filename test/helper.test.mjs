// The helper: one exit for every event (publish), and commands that never throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHelper, REPLAY } from '../engine/helper.mjs';
import { Budget } from '../usage/budget.mjs';
import { silentLogger } from '../shared/log.mjs';

// A stand-in SDK whose query() yields the messages we give it, then waits.
function fakeSdk(messages) {
  return {
    query: () => {
      let ended = false;
      const it = (async function* () { for (const m of messages) yield m; while (!ended) await new Promise((r) => setTimeout(r, 5)); })();
      return Object.assign(it, { interrupt: async () => {}, close: () => { ended = true; }, setPermissionMode: async () => {} });
    },
  };
}
const init = { type: 'system', subtype: 'init', session_id: 's1', apiKeySource: 'apiKeyHelper', permissionMode: 'default' };
const make = (messages, projects = [{ name: 'p', path: '/tmp', tag: 'personal' }]) => {
  const sent = [];
  const helper = createHelper({ projects, sdk: fakeSdk(messages), budget: new Budget(5), log: silentLogger, settings: { keychainService: 'claude-menubar-anthropic' }, send: (ev) => sent.push(ev) });
  return { helper, sent };
};
const settle = () => new Promise((r) => setTimeout(r, 40));

test('publish hides secrets in every field of every event, nested ones too', async (t) => {
  const { helper, sent } = make([init,
    { type: 'assistant', parent_tool_use_id: null, message: { content: [
      { type: 'text', text: 'key sk-ant-abcdefghijklmnop' },
      { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuv" x' } },
    ] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz012345 refused' }] } },
  ]);
  t.after(() => helper.shutdown());
  await helper.handleCommand({ type: 'send', project: 'p', text: 'go' });
  await settle();
  const all = JSON.stringify(sent);
  assert.doesNotMatch(all, /sk-ant-abcdef|abcdefghijklmnopqrstuv|ghp_abcdef/);
  assert.ok(sent.some((e) => e.type === 'tool_failed' && /GITHUB_TOKEN=\[hidden secret\] refused/.test(e.text)));
  assert.ok(sent.every((e) => e.type === 'status' || e.project === 'p'));
});

test('the hover line is sent only when it changes, with the number of open cards', async (t) => {
  const { helper, sent } = make([init]);
  t.after(() => helper.shutdown());
  await helper.handleCommand({ type: 'send', project: 'p', text: 'go' });
  await settle();
  const lines = sent.filter((e) => e.type === 'status');
  assert.ok(lines.length >= 1);
  for (let i = 1; i < lines.length; i++) assert.notDeepEqual(lines[i], lines[i - 1]);
  assert.equal(lines.at(-1).pendingCards, 0);
  assert.match(lines.at(-1).line, /Thinking · p/);
});

test('the replay list keeps only the latest events', async (t) => {
  const many = Array.from({ length: REPLAY + 50 }, (_, i) => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: `line ${i}` }] } }));
  const { helper } = make([init, ...many]);
  t.after(() => helper.shutdown());
  await helper.handleCommand({ type: 'send', project: 'p', text: 'go' });
  await settle();
  const r = await helper.handleCommand({ type: 'replay', project: 'p' });
  assert.equal(r.events.length, REPLAY);
  assert.equal(r.events.at(-1).text, `line ${REPLAY + 49}\n`);
});

test('commands never throw and always answer in plain words', async (t) => {
  const { helper } = make([init]);
  t.after(() => helper.shutdown());
  assert.deepEqual(await helper.handleCommand({ type: 'send', project: 'nope', text: 'x' }), { ok: false, error: 'There is no project by that name.' });
  assert.equal((await helper.handleCommand({ type: 'delete-everything', project: 'p' })).ok, false);
  assert.equal((await helper.handleCommand({ type: 'answer', project: 'p', id: 'gone', decision: 'allow' })).ok, false);
  assert.deepEqual(await helper.handleCommand({ type: 'history', project: 'p' }), { ok: true, sessions: [] }, 'no session list: an empty history, not a crash');
});

test('a broken session list reads as "something went wrong", never as approval', async (t) => {
  const sent = [];
  const helper = createHelper({ projects: [{ name: 'p', path: '/tmp', tag: 'work' }], sdk: { query: fakeSdk([]).query, listSessions: async () => { throw new Error('disk'); } },
    budget: new Budget(5), log: silentLogger, settings: {}, send: (ev) => sent.push(ev) });
  t.after(() => helper.shutdown());
  const r = await helper.handleCommand({ type: 'history', project: 'p' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Nothing was approved/);
});
