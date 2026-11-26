// Claude's multiple-choice questions (AskUserQuestion) as a card you tap (bug from Bromo, Nov 26:
// Allow on the old card sent no answer, so Claude said the question "didn't come through").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { questionCard, parseAnswer, typedAnswers, SKIPPED, MALFORMED } from '../policy/questions.mjs';
import { ApprovalBroker } from '../policy/approvals.mjs';
import { createHelper } from '../engine/helper.mjs';
import { Budget } from '../usage/budget.mjs';
import { KEYCHAIN_SERVICE } from '../engine/options.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude, SCENARIOS } from '../mock/fake-claude.mjs';
import { tempProject } from './support.mjs';

const opt = (label, description = '') => ({ label, description });
const one = { questions: [{ question: 'Where does the plant info come from?', header: 'Data', multiSelect: false, options: [opt('Typed in by hand', 'Fits in one day'), opt('Sensors')] }] };
const two = { questions: [one.questions[0], { question: 'Which features?', header: 'Features', multiSelect: true, options: [opt('Reminders'), opt('Photos'), opt('History')] }] };

test('the card shows each question with its options, and refuses shapes it can\'t show', () => {
  const c = questionCard(one);
  assert.equal(c.kind, 'question'); assert.equal(c.plain, 'Where does the plant info come from?');
  assert.deepEqual(c.questions[0].options[0], { label: 'Typed in by hand', note: 'Fits in one day' });
  assert.equal(questionCard(two).questions[1].multiSelect, true);
  for (const bad of [null, {}, { questions: [] }, { questions: [{ question: 'x?', options: [opt('a')] }] },
    { questions: [{ question: '', options: [opt('a'), opt('b')] }] }, { questions: [{ question: 'x?', options: [opt('a'), { label: '' }] }] },
    { questions: Array(5).fill(one.questions[0]) }, { questions: [one.questions[0], one.questions[0]] }]) assert.equal(questionCard(bad), null);
});

test('only picks that fit the questions count as an answer', () => {
  assert.deepEqual(parseAnswer('a:0', one.questions), { 'Where does the plant info come from?': 'Typed in by hand' });
  assert.deepEqual(parseAnswer('a:1;0,2', two.questions), { 'Where does the plant info come from?': 'Sensors', 'Which features?': 'Reminders, History' });
  for (const bad of ['allow', 'skip', 'a:', 'a:2', 'a:0,1', 'a:0;0', 'a:0;0,0', 'a:0;3', ' a:0', 'a:0 ', 'A:0', 7, null]) {
    assert.equal(parseAnswer(bad, bad === 'a:0;0' ? one.questions : (bad === 'a:0,1' || bad === 'a:2' ? one.questions : two.questions)), null, String(bad));
  }
  assert.deepEqual(typedAnswers('  B, but only my desk plants ', one.questions), { 'Where does the plant info come from?': 'B, but only my desk plants' });
});

test('broker: a tap answers inside the tool input; Allow, a skip or nonsense is a no; typing answers', async () => {
  const opened = []; const closed = [];
  const b = new ApprovalBroker({ onOpen: (c) => opened.push(c), onClose: (...a) => closed.push(a) });
  const p1 = b.ask('AskUserQuestion', one, {}, questionCard(one));
  assert.equal(opened[0].kind, 'question'); assert.equal(opened[0].defaultChoice, 'deny');
  b.answer(opened[0].id, 'a:0');
  const r1 = await p1;
  assert.equal(r1.behavior, 'allow'); assert.deepEqual(r1.updatedInput.questions, one.questions);
  assert.deepEqual(r1.updatedInput.answers, { 'Where does the plant info come from?': 'Typed in by hand' });
  assert.equal(closed[0][1], 'answer'); assert.match(closed[0][2], /You answered: Typed in by hand/);
  assert.equal(b.answer(opened[0].id, 'a:1'), false, 'one answer per card');

  for (const no of ['allow', 'skip', 'a:5']) {
    const p = b.ask('AskUserQuestion', one, {}, questionCard(one));
    b.answer(opened.at(-1).id, no);
    assert.deepEqual(await p, { behavior: 'deny', message: SKIPPED, toolUseID: undefined }, no);
  }
  const p3 = b.ask('AskUserQuestion', two, {}, questionCard(two));
  const plain = b.ask('Bash', { command: 'ls' }, {}, {});
  assert.equal(b.answerTyped('Sensors, and photos'), true);
  const r3 = await p3;
  assert.deepEqual(r3.updatedInput.answers, { 'Where does the plant info come from?': 'Sensors, and photos', 'Which features?': 'Sensors, and photos' });
  assert.equal(b.size, 1, 'an Allow card is not answered by typing');
  b.answer(opened.at(-1).id, 'a:0'); assert.equal((await plain).behavior, 'deny', 'picks never approve a plain card');
  assert.equal(b.answerTyped('hi'), false);
});

function harness() {
  const events = []; const answers = []; const waiters = [];
  const emit = (ev) => { events.push(ev); for (const w of [...waiters]) if (w.pred(ev)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); } };
  const dir = tempProject();
  const helper = createHelper({
    projects: [{ name: 'plants', path: dir, tag: 'personal' }], sdk: { query }, budget: new Budget(5), log: silentLogger, send: emit,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: [], spawn: (o) => createFakeClaude(o, { answers }) },
  });
  const cmd = (type, f = {}) => helper.handleCommand({ type, project: 'plants', ...f });
  const next = (pred) => events.find(pred) || new Promise((resolve) => waiters.push({ pred, resolve }));
  return { cmd, next, events, answers, close: () => { helper.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('end to end: the real SDK gets your tapped answer back to Claude Code', async (t) => {
  assert.ok(SCENARIOS.ask);
  const h = harness(); t.after(h.close);
  h.cmd('send', { text: '#ask' });
  const ap = await h.next((e) => e.type === 'approval');
  assert.equal(ap.card.kind, 'question'); assert.equal(ap.card.questions[0].options[1].label, 'Sensors');
  assert.equal(ap.card.learn, undefined, 'a question has no learn-more line');
  assert.equal((await h.cmd('answer', { id: ap.card.id, decision: 'a:0' })).ok, true);
  assert.match((await h.next((e) => e.type === 'approval_closed')).why, /Typed in by hand/);
  await h.next((e) => e.type === 'turn_done');
  assert.deepEqual(h.answers, [{ 'Where does the plant info come from?': 'Typed in by hand' }]);
});

test('end to end: typing in the chat box while a question waits is the answer, not a new message', async (t) => {
  const h = harness(); t.after(h.close);
  h.cmd('send', { text: '#ask' });
  await h.next((e) => e.type === 'approval');
  h.cmd('send', { text: 'A, typed in by hand' });
  await h.next((e) => e.type === 'turn_done');
  assert.deepEqual(h.answers, [{ 'Where does the plant info come from?': 'A, typed in by hand' }]);
  assert.equal(h.events.filter((e) => e.type === 'turn_done').length, 1, 'no second turn');
  assert.ok(MALFORMED.includes('plain words'));
});

test('window: one button per answer, Skip, no pick made for you, typed answers welcome', () => {
  const src = fs.readFileSync(new URL('../app/window/cards.js', import.meta.url), 'utf8');
  assert.match(src, /if \(card\.kind === 'question' && Array\.isArray\(card\.questions\)\) return question\(project, card, act\);/);
  assert.match(src, /button\('Skip', 'btn', \(\) => act\.answer\('skip'\)\)/);
  assert.match(src, /Or type your own answer in the chat box\./);
  assert.match(src, /querySelectorAll\('\.card-actions button, \.card-option'\)/, 'one tap counts once');
  assert.doesNotMatch(src, /\.focus\(\)|autofocus = /, 'nothing is picked or focused for you');
});
