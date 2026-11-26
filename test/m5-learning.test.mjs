// Milestone 5: the learning layer (one plain line and checked learn-more links on every card, the
// learning log tagged by Claude Academy course) and the extras (starter prompts, warm start, Wrap up,
// skill reload). The Wrap up tests snapshot the whole folder, so a stray write would show up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { LEARN_HOSTS, COURSES, TOPICS, PICKS, ALL_LINKS, isLearnLink, learnFor, topicFor, createLearnPicker, docsLink, MORE_LINE } from '../shared/learn.mjs';
import { visibleText } from '../scripts/check-learn.mjs';
import { entryFor, summarize, readLog, createLearning } from '../app/learning.mjs';
import { createChatRecord, entryText, appendHandoff } from '../engine/wrapup.mjs';
import { skillDirs, skillStamp } from '../engine/skills.mjs';
import { createHelper } from '../engine/helper.mjs';
import { Budget } from '../usage/budget.mjs';
import { KEYCHAIN_SERVICE } from '../engine/options.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';
import { tempProject, collector } from './support.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-m5-'));
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** Every file under dir, with its contents: a change anywhere shows up. */
function snapshot(dir) {
  const out = {};
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const p = path.join(e.parentPath ?? e.path, e.name);
    out[path.relative(dir, p)] = e.isFile() ? fs.readFileSync(p, 'utf8') : e.isDirectory() ? 'dir' : 'other';
  }
  return out;
}

test('every learn-more link is https on Claude Academy or the Claude Code docs', () => {
  assert.ok(ALL_LINKS.length >= 10);
  for (const url of ALL_LINKS) {
    const u = new URL(url);
    assert.equal(u.protocol, 'https:', url); assert.ok(LEARN_HOSTS.includes(u.hostname), url);
    assert.equal(u.search + u.username + u.port, '', url);
    if (u.hostname === 'academy.claude.com') assert.equal(u.hash, '', url);
    else assert.match(u.hash, /^#[a-z-]*:~:text=[^&,]+$/, `${url} opens at one highlighted passage`);
    assert.ok(isLearnLink(url), url);
  }
  const tools = [['Bash', { command: 'npm test' }], ['Bash', { command: 'git push' }], ['Edit', {}], ['Write', {}], ['Read', {}],
    ['WebFetch', {}], ['Skill', {}], ['Task', {}], ['ExitPlanMode', {}], ['mcp__hub__read_file', {}], ['SomethingNew', {}]];
  for (const [name, input] of tools) {
    const l = learnFor(name, input, false);
    assert.ok(isLearnLink(l.academy) && isLearnLink(l.docs), `${name} links are on the list`);
    assert.ok(l.line.length > 10 && l.line.length < 120, `${name} has one plain line`);
  }
  assert.equal(topicFor('Bash', { command: 'rm -rf x' }, true), 'deleting');
  assert.equal(topicFor('Bash', { command: 'cd a && git status' }), 'git');
  assert.equal(topicFor('Bash', { command: 'npm ci && npm test' }), 'chain');
});

test('Learn more fits the step, and one chat never offers the same lesson or passage twice', () => {
  const p = createLearnPicker();
  const first = p.pick('Edit', {}); const second = p.pick('Write', {}); const third = p.pick('Edit', {});
  assert.equal(first.docs, PICKS.edits[0].docs); assert.match(first.docs, /#undo-changes-with-checkpoints:~:text=File%20edits%20are%20reversible$/);
  assert.equal(second.docs, PICKS.edits[1].docs, 'the next card gets the next most useful passage');
  assert.match(first.line, /Undo/); assert.equal(second.line, MORE_LINE, 'the plain line shows once a chat');
  assert.equal(third.seen, true); assert.equal(third.academy, undefined); assert.equal(third.docs, undefined);
  assert.equal(third.line, undefined, 'nothing new: no learning box at all');
  // Across kinds: after two command cards, a chained command offers only what's new (its passage, not the lesson).
  const q = createLearnPicker(); q.pick('Bash', { command: 'ls' }); q.pick('Bash', { command: 'ls' });
  const chain = q.pick('Bash', { command: 'a && b' });
  assert.equal(chain.academy, undefined, 'that lesson was shown already'); assert.match(chain.docs, /#compound-commands:~:text=/);
  assert.equal(q.pick('Bash', { command: 'a && b' }).seen, true, 'its other pick was all shown on the command cards');
  const shown = [first, second, chain, ...[1, 2, 3].map(() => q.pick('Read', {}))].flatMap((x) => [x.academy, x.docs]).filter(Boolean);
  assert.ok(shown.every(isLearnLink));
  assert.ok(createLearnPicker().pick('Edit', {}).docs, 'a new chat starts fresh');
  assert.equal(docsLink('p', 's', 'a-b, c'), 'https://code.claude.com/docs/en/p#s:~:text=a%2Db%2C%20c', 'dashes and commas are escaped');
  assert.equal(visibleText('<p>File <strong>edits</strong>&nbsp;are</p><script>x</script>'), ' File edits are ');
});

test('near-miss links are refused', () => {
  const good = COURSES['Claude Code 101'];
  for (const bad of [good.replace('https', 'http'), `${good}?x=1`, `${good}#a`, `${good}/`, good.replace('academy.claude.com', 'academy.claude.com.evil.io'),
    good.replace('https://', 'https://me@'), good.replace('claude.com', 'claude.com:8443'), 'https://code.claude.com/docs/en/other',
    'https://evil.io/academy.claude.com', 'javascript:alert(1)', '', null, 42]) {
    assert.equal(isLearnLink(bad), false, String(bad));
  }
});

test('learning log: each entry carries an Academy course tag and never the command', () => {
  for (const [topic, picks] of Object.entries(PICKS)) for (const p of picks) assert.ok(COURSES[p.course] && p.academy.startsWith(`${COURSES[p.course]}/`), `${topic}: the lesson is in its course`);
  const ev = { type: 'approval', project: 'site', card: { command: 'cat ~/.secret', learn: learnFor('Bash', { command: 'git pull' }) } };
  const e = entryFor(ev, new Date('2026-11-26T10:00:00Z'));
  assert.deepEqual(e, { at: '2026-11-26T10:00:00.000Z', project: 'site', topic: 'git', course: 'Claude Code 101' });
  assert.equal(entryFor({ card: { learn: { topic: 'git', course: 'Made up' } } }), null);
  assert.doesNotMatch(JSON.stringify(e), /secret|cat /);
  assert.equal(entryFor({ card: { learn: { topic: '__proto__' } } }), null);
  assert.equal(entryFor({ card: {} }), null);
  const s = summarize([e, { ...e, topic: 'planning' }, { ...e, course: 'Made up' }, entryFor({ project: 'x', card: { learn: learnFor('Skill', {}) } })]);
  assert.equal(s[0].course, 'Claude Code 101'); assert.equal(s[0].count, 2); assert.deepEqual(s[0].topics, ['git', 'planning']);
  assert.equal(s.find((c) => c.course === 'Introduction to agent skills').count, 1);
  assert.equal(s.reduce((n, c) => n + c.count, 0), 3, 'an entry with an unknown course is not counted');
});

test('learning log file: main records cards, the window gets a summary, links open only from the list', async () => {
  const dir = tmp(); const file = path.join(dir, 'learning-log.jsonl'); const opened = []; const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const ours = { ours: true };
  const l = createLearning({ ipcMain, shell: { openExternal: (u) => opened.push(u) }, fromOurWindow: (e) => e === ours, file });
  l.record({ type: 'approval', project: 'site', card: { learn: learnFor('Edit', {}) } });
  l.record({ type: 'approval', project: 'site', card: {} });
  assert.equal(readLog(file).length, 1);
  assert.equal((await handlers['learn:summary'](ours)).courses[0].count, 1);
  assert.deepEqual(await handlers['learn:summary']({}), { ok: false });
  assert.equal((await handlers['learn:open'](ours, 'https://evil.io/')).ok, false);
  assert.equal((await handlers['learn:open']({}, COURSES['Claude Code 101'])).ok, false, 'not from our window');
  assert.equal((await handlers['learn:open'](ours, COURSES['Claude Code 101'])).ok, true);
  assert.deepEqual(opened, [COURSES['Claude Code 101']]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Wrap up writes one entry to HANDOFF.md and changes nothing else', () => {
  const dir = tempProject();
  fs.mkdirSync(path.join(dir, 'src')); fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'x\n');
  const r = createChatRecord();
  r.ask('Fix the typo in notes.txt, my key is sk-ant-abcdef1234567890');
  r.note({ type: 'change', sentence: 'Changed notes.txt: fixed "teh".' }); r.note({ type: 'approval_closed', decision: 'allow' });
  r.note({ type: 'approval_closed', decision: 'deny' }); r.note({ type: 'turn_done', costUsd: 0.04 }); r.note({ type: 'suggestions', items: ['Run the tests'] });
  const before = snapshot(dir);
  const at = new Date(2026, 10, 26, 9, 5);
  const one = appendHandoff(dir, entryText(r.data, { project: 'site', at }));
  assert.equal(one.ok, true);
  const after = snapshot(dir); const text = after['HANDOFF.md']; delete after['HANDOFF.md'];
  assert.deepEqual(after, before, 'only HANDOFF.md is new');
  assert.equal(text.match(/^## /gm).length, 1, 'exactly one entry');
  assert.match(text, /## 2026-11-26 09:05 · site · chat wrap-up/);
  assert.match(text, /Changed notes\.txt/); assert.match(text, /1 allowed, 1 not run/); assert.match(text, /\$0\.04/);
  assert.doesNotMatch(text, /sk-ant-abcdef/, 'secrets are hidden in the note too');
  assert.equal(appendHandoff(dir, entryText(r.data, { project: 'site', at })).ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'HANDOFF.md'), 'utf8').match(/^## /gm).length, 2, 'a second Wrap up adds to the end');
  assert.ok(fs.readFileSync(path.join(dir, 'HANDOFF.md'), 'utf8').startsWith(text), 'nothing earlier was changed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Wrap up leaves a HANDOFF.md that is a link alone', () => {
  const dir = tempProject(); const elsewhere = path.join(tmp(), 'target.md'); fs.writeFileSync(elsewhere, 'keep\n');
  fs.symlinkSync(elsewhere, path.join(dir, 'HANDOFF.md'));
  const r = appendHandoff(dir, '## entry\n');
  assert.equal(r.ok, false); assert.equal(fs.readFileSync(elsewhere, 'utf8'), 'keep\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

function helperFor(t, dir, home) {
  const c = collector(); const spawns = [];
  const helper = createHelper({
    projects: [{ name: 'site', path: dir, tag: 'personal' }], sdk: { query }, budget: new Budget(5), log: silentLogger, send: c.push,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: [], home, spawn: (o) => { spawns.push(o.args); return createFakeClaude(o); } },
  });
  t.after(() => helper.shutdown());
  return { c, helper, spawns };
}

test('cards carry the learning line; Wrap up through the helper writes HANDOFF.md', async (t) => {
  const dir = tempProject(); const home = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { c, helper } = helperFor(t, dir, home);
  assert.equal((await helper.handleCommand({ type: 'wrapUp', project: 'site' })).ok, false, 'nothing to wrap up yet');
  assert.equal(fs.existsSync(path.join(dir, 'HANDOFF.md')), false);
  await helper.handleCommand({ type: 'send', project: 'site', text: '#edit' });
  const card = (await c.next((e) => e.type === 'approval')).card;
  assert.equal(card.learn.topic, 'edits'); assert.ok(isLearnLink(card.learn.academy) && isLearnLink(card.learn.docs));
  await helper.handleCommand({ type: 'answer', project: 'site', id: card.id, decision: 'allow' });
  await c.next((e) => e.type === 'turn_done');
  const r = await helper.handleCommand({ type: 'wrapUp', project: 'site' });
  assert.equal(r.ok, true, r.text);
  const text = fs.readFileSync(path.join(dir, 'HANDOFF.md'), 'utf8');
  assert.match(text, /You asked:\*\* #edit/); assert.match(text, /1 allowed/);
  await helper.handleCommand({ type: 'newChat', project: 'site' });
  await helper.handleCommand({ type: 'send', project: 'site', text: '#hello' });
  await c.next((e) => e.type === 'turn_done' && c.of('turn_done').length === 2);
  assert.equal((await helper.handleCommand({ type: 'wrapUp', project: 'site' })).ok, true);
  const second = fs.readFileSync(path.join(dir, 'HANDOFF.md'), 'utf8').slice(text.length);
  assert.match(second, /You asked:\*\* #hello/, 'a new chat keeps its first message');
  assert.doesNotMatch(second, /#edit|1 allowed/, 'and starts its own record');
});

test('warm starts Claude Code once; new skills are picked up in the same chat', async (t) => {
  const dir = tempProject(); const home = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { c, helper, spawns } = helperFor(t, dir, home);
  await helper.handleCommand({ type: 'warm', project: 'site' }); await helper.handleCommand({ type: 'warm', project: 'site' });
  await helper.handleCommand({ type: 'send', project: 'site', text: '#hello' });
  const sid = (await c.next((e) => e.type === 'session')).sessionId;
  await c.next((e) => e.type === 'turn_done');
  assert.equal(spawns.length, 1, 'warm twice plus a message is still one Claude Code');
  await helper.handleCommand({ type: 'send', project: 'site', text: '#hello' });
  await c.next((e) => e.type === 'turn_done' && c.of('turn_done').length === 2);
  assert.equal(spawns.length, 1, 'no change, no restart');
  fs.mkdirSync(path.join(dir, '.claude', 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\n');
  await helper.handleCommand({ type: 'send', project: 'site', text: '#hello' });
  const hint = await c.next((e) => e.type === 'hint' && e.kind === 'skills');
  assert.match(hint.text, /skills/);
  await c.next((e) => e.type === 'turn_done' && c.of('turn_done').length === 3);
  assert.equal(spawns.length, 2);
  assert.ok(spawns[1].includes(`--resume=${sid}`), 'the same chat carries on');
  assert.deepEqual(skillDirs('/p', '/h').sort(), ['/h/.claude/commands', '/h/.claude/skills', '/p/.claude/commands', '/p/.claude/skills']);
  assert.notEqual(skillStamp(skillDirs(dir, home)), '');
});

test('window: learn links go through the checked list, starters fill the box, Wrap up asks first', () => {
  const cards = read('app/window/cards.js'); const log = read('app/window/log.js'); const panel = read('app/window/panel.js');
  const app = read('app/window/app.js'); const main = read('app/main.mjs'); const pre = read('app/preload.cjs');
  assert.match(cards, /button\('Learn more'/); assert.doesNotMatch(cards + log + panel, /innerHTML|<a /);
  assert.match(app, /learn: \(u\) => api\.openLearn\(u\)/);
  assert.match(pre, /openLearn: \(url\) => ipcRenderer\.invoke\('learn:open', url\)/);
  assert.match(main, /learning\?\.record\(ev\)/);
  assert.match(log, /\(\) => fill\?\.\(s\)/, 'a starter fills the box');
  assert.doesNotMatch(log.slice(log.indexOf('function emptyState')), /^.*api\.send/m, 'a starter never sends by itself');
  assert.match(panel, /confirm\(s, 'Add a dated note about this chat to the end of HANDOFF\.md/);
  assert.match(panel, /'Add the note', async \(\) => say\(await ctx\.api\.wrapUp\(name\)\)/, 'Wrap up runs only after the second answer');
  assert.match(app, /if \(state\.warm\) api\.warm\(name\)/);
});
