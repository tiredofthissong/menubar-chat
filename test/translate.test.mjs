// translate.mjs is the only reader of SDK message shapes. These pin the shapes it reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { translate, newScratch } from '../engine/translate.mjs';
import { EVENT_TYPES } from '../shared/contract.mjs';

const delta = (text, parent = null) => ({ type: 'stream_event', parent_tool_use_id: parent, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const assistant = (content, extra = {}) => ({ type: 'assistant', parent_tool_use_id: null, message: { content, usage: { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 } }, ...extra });

test('init: session id, key source, mode and slash commands', () => {
  const { facts, events } = translate({ type: 'system', subtype: 'init', session_id: 's1', apiKeySource: 'apiKeyHelper', permissionMode: 'default', slash_commands: ['review'] }, newScratch());
  assert.deepEqual(facts.init, { sessionId: 's1', apiKeySource: 'apiKeyHelper', permissionMode: 'default', slashCommands: ['review'] });
  assert.deepEqual(events, []);
});

test('streamed text leaves whole lines; the rest leaves when the message ends', () => {
  const st = newScratch();
  assert.deepEqual(translate(delta('Hello wor'), st).events, []);
  assert.deepEqual(translate(delta('ld\nand mo'), st).events.map((e) => e.text), ['Hello world\n']);
  const end = translate(assistant([{ type: 'text', text: 'Hello world\nand more' }]), st);
  assert.deepEqual(end.events.map((e) => e.text), ['and mo'], 'the streamed text is not sent twice');
});

test('an unfinished private key is held whole, then a very long line leaves at a space', () => {
  const st = newScratch();
  assert.deepEqual(translate(delta('ok\n-----BEGIN RSA PRIVATE KEY-----\nabc\n'), st).events.map((e) => e.text), ['ok\n']);
  assert.deepEqual(translate(delta('def\n-----END RSA PRIVATE KEY-----\n'), st).events.map((e) => e.text), ['-----BEGIN RSA PRIVATE KEY-----\nabc\ndef\n-----END RSA PRIVATE KEY-----\n']);
  const long = translate(delta('word '.repeat(100)), st).events;
  assert.equal(long.length, 1); assert.ok(long[0].text.length > 400);
});

test('text that was not streamed is sent from the assistant message', () => {
  const { events } = translate(assistant([{ type: 'text', text: 'Hi' }]), newScratch());
  assert.deepEqual(events.map((e) => [e.type, e.text]), [['text', 'Hi\n']]);
});

test('sub-agent messages stay out of the main chat', () => {
  const st = newScratch();
  assert.deepEqual(translate(delta('inner\n', 'toolu_x'), st).events, []);
  assert.deepEqual(translate(assistant([{ type: 'text', text: 'inner' }], { parent_tool_use_id: 'toolu_x' }), st).events, []);
});

test('a tool call: one plain line, and for edits whether a Why: line came first', () => {
  const st = newScratch('/work/p');
  translate(delta('Why: the date was wrong.\n'), st);
  const { events, facts } = translate(assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/work/p/a.md' } }]), st);
  assert.deepEqual(events.map((e) => e.type), ['tool', 'why']);
  assert.equal(events[0].line, 'Change a.md.');
  assert.deepEqual([events[1].seen, events[1].why], [true, 'the date was wrong.']);
  assert.equal(st.whyByTool.get('toolu_1'), 'the date was wrong.');
  assert.equal(facts.toolStarted, 'Change a.md.');
  assert.equal(facts.requestTokens, 125);
  const next = translate(assistant([{ type: 'tool_use', id: 'toolu_2', name: 'Write', input: { file_path: 'b.md' } }]), st);
  assert.equal(next.events[1].seen, false, 'one Why: line counts for one edit only');
});

test('tool results: ok or not, the text, and the patch when Claude Code sends one', () => {
  const hunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }];
  const { facts } = translate({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 't1', content: 'done' },
    { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'Denied' }], is_error: true },
  ] }, tool_use_result: { structuredPatch: hunks } }, newScratch());
  assert.deepEqual(facts.toolResults, [
    { toolUseId: 't1', ok: true, text: 'done', hunks },
    { toolUseId: 't2', ok: false, text: 'Denied', hunks },
  ]);
});

test('result: running cost, context window and unknown prices', () => {
  const { facts } = translate({ type: 'result', is_error: false, total_cost_usd: 0.42, modelUsage: { a: { contextWindow: 200000 }, b: { contextWindow: 1000000, costBasis: 'unknown' } } }, newScratch());
  assert.deepEqual(facts.result, { ok: true, totalCostUsd: 0.42, windows: [200000, 1000000], priceUnknown: true });
  assert.equal(translate({ type: 'result', is_error: true }, newScratch()).facts.result.ok, false);
});

test('odd or unknown messages never throw', () => {
  for (const m of [null, {}, { type: 'assistant' }, { type: 'user', message: { content: 'text' } }, { type: 'stream_event' }, { type: 'mystery' }]) {
    assert.doesNotThrow(() => translate(m, newScratch()));
  }
});

test('no other file reads SDK message shapes', () => {
  const dirs = ['engine', 'policy', 'changes', 'usage', 'status', 'sidebar', 'shared', 'app'];
  const shapes = /\.(subtype|stream_event|content_block_delta|tool_use_result|total_cost_usd|modelUsage|parent_tool_use_id)\b|'content_block_delta'|'stream_event'/;
  for (const d of dirs) {
    for (const f of fs.readdirSync(new URL(`../${d}/`, import.meta.url)).filter((n) => /\.(mjs|js|cjs)$/.test(n))) {
      if (`${d}/${f}` === 'engine/translate.mjs') continue;
      const src = fs.readFileSync(new URL(`../${d}/${f}`, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
      assert.doesNotMatch(src, shapes, `${d}/${f}`);
    }
  }
  assert.ok(EVENT_TYPES.includes('text'));
});
