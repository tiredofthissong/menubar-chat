// The window and menu bar parts that can be checked without a Mac screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Animator, FRAMES } from '../app/animator.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// Code only: comments may mention the things we forbid.
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('every icon frame exists at 1x and 2x', () => {
  for (const name of new Set(Object.values(FRAMES).flat())) {
    for (const suffix of ['Template.png', 'Template@2x.png']) {
      assert.ok(fs.existsSync(new URL(`../app/icons/${name}${suffix}`, import.meta.url)), `${name}${suffix}`);
    }
  }
});

function fakeAnimator(reduced) {
  const shown = []; let tick = null;
  const a = new Animator({
    tray: { setImage: (img) => shown.push(img.name) }, dir: '/icons',
    nativeImage: { createFromPath: (p) => ({ name: path.basename(p).replace('Template.png', ''), setTemplateImage() {} }) },
    systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: reduced }) },
    setTimer: (fn) => { tick = fn; return 1; }, clearTimer: () => { tick = null; },
  });
  return { a, shown, tick: () => tick?.() };
}

test('icon animates while working and holds still with Reduce Motion', () => {
  const moving = fakeAnimator(false);
  moving.a.setState('working'); moving.tick(); moving.tick();
  assert.deepEqual(moving.shown, ['working-0', 'working-1', 'working-2']);
  moving.a.setState('idle'); moving.tick();
  assert.equal(moving.shown.at(-1), 'idle');

  const still = fakeAnimator(true);
  still.a.setState('working'); still.tick(); still.tick();
  assert.deepEqual(still.shown, ['working-0']);
});

test('window: strict content policy, plain script, no innerHTML', () => {
  const html = read('app/window/index.html');
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; script-src 'self'/);
  assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'no inline script');
  for (const f of ['app/window/app.js', 'app/window/markdown.js']) {
    assert.doesNotMatch(code(f), /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/, f);
  }
});

test('approval buttons: Allow and Deny look the same and neither is pre-selected', () => {
  const js = read('app/window/app.js');
  assert.match(js, /el\('button', 'btn', 'Deny'\)/);
  assert.match(js, /el\('button', 'btn', 'Allow once'\)/);
  assert.doesNotMatch(js, /autofocus|\.focus\(\)[^;]*allow/i);
});

test('styles follow the design rules', () => {
  const css = code('app/window/app.css');
  assert.doesNotMatch(css, /transition:\s*all/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb\(/i, 'colors come from tokens only');
  assert.doesNotMatch(css, /var\(--radius-lg\)/, 'two radii plus pill');
  assert.match(css, /prefers-reduced-motion: no-preference/);
});

test('main process: sandboxed window, sender checks on every message, vetted outside links only', () => {
  const main = read('app/main.mjs');
  assert.match(main, /contextIsolation: true, sandbox: true, nodeIntegration: false/);
  const handlers = main.match(/ipcMain\.(on|handle)\('[^']+'/g) || [];
  assert.ok(handlers.length >= 7);
  for (const h of handlers) {
    const name = h.match(/'([^']+)'/)[1];
    const body = main.slice(main.indexOf(h), main.indexOf(h) + 160);
    assert.match(body, /fromOurWindow\(e\)/, `${name} checks the sender`);
  }
  assert.match(main, /will-navigate', \(ev\) => ev\.preventDefault\(\)/);
  assert.match(main, /academy\\\.claude\\\.com\|code\\\.claude\\\.com/);
  assert.doesNotMatch(main, /find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'/, 'presence check never reads the key');
});

test('preload is CommonJS and exposes only the bridge', () => {
  const pre = read('app/preload.cjs');
  assert.match(pre, /require\('electron'\)/);
  assert.match(pre, /exposeInMainWorld\('menubarChat'/);
  assert.doesNotMatch(pre, /require\('(fs|child_process|node:)/);
});
