// scroll.test.mjs - the conversation can be read back, and new messages don't yank you away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../app/window/scroll.js', import.meta.url), 'utf8');
const ctx = { window: {} }; vm.runInNewContext(src, ctx);
const S = ctx.window.ChatScroll;
const box = (scrollHeight, clientHeight, scrollTop) => ({ scrollHeight, clientHeight, scrollTop });

test('at the bottom counts as following; scrolled up does not', () => {
  assert.equal(S.isAtBottom(box(2000, 500, 1500)), true);
  assert.equal(S.isAtBottom(box(2000, 500, 1470)), true, 'within the slack');
  assert.equal(S.isAtBottom(box(2000, 500, 900)), false, 'reading back');
  assert.equal(S.isAtBottom(box(400, 500, 0)), true, 'nothing to scroll');
});

test('a wheel turn the browser ignored still moves the conversation', () => {
  const el = box(2000, 500, 1500);
  assert.equal(S.fallbackScroll(el, 1500, -300), 1200);
  assert.equal(el.scrollTop, 1200);
});

test('the backup does nothing when the browser already scrolled, or at the ends', () => {
  const moved = box(2000, 500, 1300);
  assert.equal(S.fallbackScroll(moved, 1500, -300), null, 'browser handled it');
  assert.equal(moved.scrollTop, 1300);
  const top = box(2000, 500, 0);
  assert.equal(S.fallbackScroll(top, 0, -300), null, 'already at the top');
  const bottom = box(2000, 500, 1500);
  assert.equal(S.fallbackScroll(bottom, 1500, 300), null, 'already at the bottom');
  const near = box(2000, 500, 100);
  assert.equal(S.fallbackScroll(near, 100, -300), 0, 'stops at the top');
});

test('wheel lines and pages turn into pixels', () => {
  assert.equal(S.wheelPixels({ deltaMode: 0, deltaY: 42 }, 500), 42);
  assert.equal(S.wheelPixels({ deltaMode: 1, deltaY: 3 }, 500), 48);
  assert.equal(S.wheelPixels({ deltaMode: 2, deltaY: -1 }, 500), -500);
});

test('the window is asked to resize only when the size really changed', () => {
  const gate = S.makeSizeGate();
  assert.equal(gate(700), true);
  assert.equal(gate(700), false);
  assert.equal(gate(703), false, 'a few pixels is not a change');
  assert.equal(gate(760), true);
  assert.equal(gate(NaN), false);
});

test('the window wires it up: scroll.js loads first, the log follows only when at the bottom', () => {
  const html = fs.readFileSync(new URL('../app/window/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('src="scroll.js"') > -1 && html.indexOf('src="scroll.js"') < html.indexOf('src="app.js"'));
  const js = fs.readFileSync(new URL('../app/window/app.js', import.meta.url), 'utf8');
  const addText = /function addText[\s\S]*?\n  \}/.exec(js)[0];
  assert.doesNotMatch(addText, /scrollTop/, 'streamed text must not force the view to the bottom');
  assert.match(addText, /followIfStuck/);
  assert.match(js, /addEventListener\('wheel'/);
  const css = fs.readFileSync(new URL('../app/window/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.log \{[^}]*overflow-y: auto/);
});
