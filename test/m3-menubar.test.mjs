// Milestone 3: how the app feels from the menu bar. The tuck-away rules, the hover line, the icon,
// the notification and the suggested next steps, all checked without a Mac screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { holdReason, TuckTimer, TUCK_AFTER_MS } from '../app/tuck.mjs';
import { approvalNotice, ACTIONS } from '../app/notify.mjs';
import { Animator } from '../app/animator.mjs';
import { StatusBoard } from '../status/status.mjs';
import { pullNext, NEXT_RULE, MAX_NEXT } from '../engine/next.mjs';
import { buildQueryOptions } from '../engine/options.mjs';
import { createHelper } from '../engine/helper.mjs';
import { Budget } from '../usage/budget.mjs';
import { KEYCHAIN_SERVICE } from '../engine/options.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';
import { tempProject, collector } from './support.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// A tuck timer with a hand-driven clock and a window we control.
function rig(start = {}) {
  const w = { visible: true, hovered: false, typing: false, pendingCards: 0, busy: 0, ...start };
  let fn = null; let hidden = 0;
  const t = new TuckTimer({
    hide: () => { hidden++; w.visible = false; }, state: () => ({ ...w }),
    setTimer: (f, ms) => { assert.equal(ms, TUCK_AFTER_MS); fn = f; return 1; }, clearTimer: () => { fn = null; },
  });
  return { t, w, tick: () => { const f = fn; fn = null; f?.(); }, waiting: () => fn !== null, hidden: () => hidden };
}

test('tuck-away: about 5 seconds after a reply, it tucks away by itself', () => {
  assert.equal(TUCK_AFTER_MS, 5000);
  const r = rig(); r.t.replied(); assert.equal(r.waiting(), true);
  r.tick(); assert.equal(r.hidden(), 1);
});

test('tuck-away: never while you type, a card waits or Claude is still working', () => {
  for (const hold of [{ typing: true }, { pendingCards: 1 }, { busy: 1 }]) {
    const r = rig(); r.t.replied(); Object.assign(r.w, hold); r.tick();
    assert.equal(r.hidden(), 0, JSON.stringify(hold));
    Object.assign(r.w, { typing: false, pendingCards: 0, busy: 0 }); r.t.changed(); r.tick();
    assert.equal(r.hidden(), 0, 'once you engage, only the next reply counts again');
  }
  const r = rig(); r.t.replied(); r.w.typing = true; r.t.changed();
  assert.equal(r.waiting(), false, 'typing stops the count at once');
});

test('tuck-away: the pointer over the window holds it, and the count restarts when it leaves', () => {
  const r = rig(); r.t.replied();
  r.w.hovered = true; r.t.changed(); assert.equal(r.waiting(), false);
  r.w.hovered = false; r.t.changed(); assert.equal(r.waiting(), true);
  r.tick(); assert.equal(r.hidden(), 1);
  const late = rig({ hovered: true }); late.t.replied(); late.tick(); assert.equal(late.hidden(), 0);
  late.w.hovered = false; late.t.changed(); late.tick(); assert.equal(late.hidden(), 1);
});

test('tuck-away: an old reply never tucks a freshly opened window', () => {
  const r = rig(); r.t.replied(); r.t.cancel(); r.tick();
  assert.equal(r.hidden(), 0);
  r.t.changed(); assert.equal(r.waiting(), false);
  assert.equal(holdReason({ visible: false }), 'hidden');
  assert.equal(holdReason({ visible: true, hovered: false, typing: false, pendingCards: 0, busy: 0 }), null);
});

test('tuck-away: Esc, a second click, clicking away and the hotkey are wired in the real app', () => {
  const main = code('app/main.mjs'); const win = code('app/window/app.js');
  assert.match(main, /preloadWindow: true/, 'built once and kept ready');
  assert.match(main, /globalShortcut\.register\(HOTKEY, \(\) => \{ if \(mb\) toggle\('hotkey'\); \}\)/);
  assert.match(main, /const HOTKEY = 'Control\+Alt\+Command\+C'/);
  assert.doesNotMatch(main, /alwaysOnTop|showOnAllWorkspaces: true/, 'menubar tucks it away on click-away and on a second click');
  assert.match(main, /mb\.on\('after-show', \(\) => \{\s*tuck\.cancel\(\)/);
  assert.match(main, /ev\.type === 'turn_done'\) tuck\.replied\(\)/);
  assert.match(win, /e\.key !== 'Escape'[\s\S]*api\.hide\(\)/);
  assert.match(win, /case 'opened': \$\('input'\)\.focus\(\)/, 'the cursor lands in the chat box');
});

test('hover line: under 100 characters, never a key, "Waiting on you" stays while a card is open', () => {
  const s = new StatusBoard();
  s.set('a'.repeat(150) + ' sk-ant-api03-abcdefabcdef1234567890', 'working', 'y'.repeat(200));
  assert.ok(s.top().line.length < 100); assert.doesNotMatch(s.top().line, /sk-ant-/);
  s.setPendingCards('p', 1);
  for (const later of ['working', 'thinking', 'idle', 'error', 'stopped']) {
    s.set('p', later, 'something else');
    assert.equal(s.top().state, 'waiting', later); assert.match(s.top().line, /^Waiting on you · p/);
  }
  s.set('q', 'error', 'broke'); assert.equal(s.top().state, 'waiting', 'another project cannot push it aside');
  assert.ok(s.top().line.length < 100); assert.match(s.top().line, /\(\+2 more\)$/);
  assert.equal(s.busy(), 1);
  s.setPendingCards('p', 0); assert.notEqual(s.top().state, 'waiting');
});

test('icon: moves while working, blinks slowly while waiting, and follows Reduce Motion as it changes', () => {
  let reduced = false; const shown = []; let tick = null; let ms = 0;
  const a = new Animator({
    tray: { setImage: (img) => shown.push(img.name) }, dir: '/icons',
    nativeImage: { createFromPath: (p) => ({ name: path.basename(p).replace('Template.png', ''), setTemplateImage() {} }) },
    systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: reduced }) },
    setTimer: (fn, every) => { tick = fn; ms = every; return 1; }, clearTimer: () => { tick = null; },
  });
  a.setState('waiting'); assert.ok(ms >= 500, 'slow blink'); tick();
  assert.deepEqual(shown, ['waiting-0', 'waiting-1']);
  reduced = true; a.refresh(); assert.equal(tick, null, 'still with Reduce Motion'); assert.equal(shown.at(-1), 'waiting-0');
  reduced = false; a.refresh(); assert.notEqual(tick, null, 'moves again when it is turned off');
  assert.match(code('app/main.mjs'), /NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification', \(\) => animator\.refresh\(\)/);
});

test('notification: Review and Deny only, short, never a key', () => {
  const n = approvalNotice({ project: 'demo', card: { plain: 'Run git push with token sk-ant-api03-abcdefabcdef1234567890 ' + 'x'.repeat(300) } });
  assert.deepEqual(ACTIONS, ['Review', 'Deny']);
  assert.deepEqual(n.actions.map((x) => x.text), ['Review', 'Deny']);
  assert.equal(n.closeButtonText, undefined, 'no third button');
  assert.ok(n.body.length <= 180); assert.doesNotMatch(n.body + n.title, /sk-ant-/);
  assert.equal(approvalNotice({ project: 'demo', card: {} }).body, 'Claude wants to do something.');
  assert.match(code('app/main.mjs'), /new Notification\(approvalNotice\(ev\)\)/);
  assert.doesNotMatch(code('app/main.mjs'), /decision: 'allow'/, 'a notification can never allow');
});

test('next steps: "Next:" lines come out of the reply and become at most three buttons', () => {
  const found = [];
  const rest = pullNext('All done.\nNext: Run the tests\n- **Next:** Fix the typo\nNext: run the tests\nnext step: nothing\n', found);
  assert.deepEqual(found, ['Run the tests', 'Fix the typo']);
  assert.equal(rest, 'All done.\nnext step: nothing\n');
  pullNext(['Next: a', 'Next: b', 'Next: c', 'Next: ' + 'z'.repeat(200)].join('\n'), found);
  assert.equal(found.length, MAX_NEXT);
  assert.match(buildQueryOptions({ project: { name: 'p', path: '/tmp' }, mode: 'default', canUseTool: () => {}, preToolUseHook: () => {}, keychainService: KEYCHAIN_SERVICE }).systemPrompt.append, /"Next:"/);
  assert.match(NEXT_RULE, /Never suggest deleting files/);
});

test('next steps: a button only sends its words as your message, and old ones switch off', () => {
  const log = code('app/window/log.js'); const app = code('app/window/app.js');
  assert.match(app, /case 'suggestions': Log\.next\(p, \(ev\.items \|\| \[\]\)\.slice\(0, 3\), \(item\) => sendText\(p, item\)\)/);
  assert.match(log, /aria-label', 'Suggested next steps'/);
  assert.match(log, /querySelectorAll\('\.next button'\)\) b\.disabled = true/);
});

test('end to end: the reply shows without its "Next:" lines and the window gets the buttons', async (t) => {
  const c = collector(); const dir = tempProject(); const name = 'personal-demo';
  const helper = createHelper({
    projects: [{ name, path: dir, tag: 'personal' }], sdk: { query }, budget: new Budget(5), log: silentLogger, send: c.push,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: ['~/claude-hub'], spawn: (o) => createFakeClaude(o) },
  });
  t.after(() => { helper.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  await helper.handleCommand({ type: 'send', project: name, text: '#next' });
  const s = await c.next((e) => e.type === 'suggestions');
  assert.deepEqual(s.items, ['Run the tests', 'Fix the typo in notes.txt']);
  await c.next((e) => e.type === 'turn_done');
  const said = c.of('text').map((e) => e.text).join('');
  assert.match(said, /Done looking\./); assert.doesNotMatch(said, /Next:/);
  assert.ok(c.of('status').every((e) => typeof e.busy === 'number'));
});
