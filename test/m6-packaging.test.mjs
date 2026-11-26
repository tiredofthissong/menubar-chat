// Milestone 6: the installed app, Start at login (off until you turn it on), Quit, and a PATH that
// finds git and Homebrew when the app is opened from the Finder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, LEFT_OUT, packageOptions } from '../scripts/package-mac.mjs';
import { createLoginItem, trayMenuTemplate, withCommonPaths, QUIT_LABEL } from '../app/login-item.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the built app: its own name, menu bar only, Claude Code runs from it, no tests inside', () => {
  const o = packageOptions({ root: '/r', platform: 'darwin', arch: 'arm64' });
  assert.equal(o.name, 'Menu Bar Chat'); assert.equal(APP_NAME, o.name); assert.equal(o.executableName, o.name);
  assert.doesNotMatch(o.name, /claude code/i, 'never named after Claude Code');
  assert.equal(o.asar, false, 'the SDK runs its own program from the app folder, which an archive would block');
  assert.equal(o.extendInfo.LSUIElement, true, 'no Dock icon');
  assert.equal(o.out, path.join('/r', 'dist')); assert.equal(o.prune, true);
  assert.equal(o.osxSign, undefined, 'no developer certificate: the script signs ad hoc for this Mac only');
  const left = (p) => LEFT_OUT.some((r) => r.test(p));
  for (const p of ['/test/x.test.mjs', '/mock/fake-claude.mjs', '/dist/a', '/.git/HEAD', '/proving-results.md', '/scripts/smoke-electron.mjs', '/scripts/package-mac.mjs', '/scripts/make-icons.mjs']) assert.ok(left(p), `${p} stays out`);
  for (const p of ['/app/main.mjs', '/engine/helper.mjs', '/scripts/block-pushes.mjs', '/node_modules/menubar/package.json', '/testing-notes']) assert.ok(!left(p), `${p} goes in`);
  assert.equal(packageOptions({ root: '/r', platform: 'linux', arch: 'x64' }).executableName, 'menu-bar-chat');
});

test('npm run package builds, signs ad hoc on the Mac, and never installs or opens anything', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.package, 'node scripts/package-mac.mjs');
  assert.ok(pkg.devDependencies['@electron/packager'], 'a build tool only, not part of the app');
  assert.ok(!pkg.dependencies['@electron/packager']);
  const src = read('scripts/package-mac.mjs');
  assert.match(src, /'--sign', '-'/);
  assert.doesNotMatch(src, /\/Applications|open -a|LoginItem|xattr/, 'copying, opening and login are your steps');
  assert.match(read('.gitignore'), /^dist\/$/m);
});

const fakeApp = (packaged, on = false) => {
  const calls = [];
  return { calls, isPackaged: packaged, getLoginItemSettings: () => ({ openAtLogin: on }), setLoginItemSettings: (s) => calls.push(s) };
};

test('Start at login: only in the installed app, off until you turn it on, and only a yes or no', () => {
  const dev = fakeApp(false); const d = createLoginItem({ app: dev, platform: 'darwin' });
  assert.equal(d.available(), false); assert.equal(d.set(true), false); assert.deepEqual(dev.calls, [], 'from the Terminal it would add Electron itself');
  const [item] = trayMenuTemplate({ login: d, quit: () => {} });
  assert.equal(item.enabled, false); assert.equal(item.checked, false); assert.match(item.label, /installed app/);

  const mac = fakeApp(true); const m = createLoginItem({ app: mac, platform: 'darwin' });
  assert.equal(m.isOn(), false, 'off by default');
  for (const bad of ['yes', 1, null, undefined, {}]) assert.equal(m.set(bad), false);
  assert.deepEqual(mac.calls, []);
  const menu = trayMenuTemplate({ login: m, quit: () => {} });
  assert.equal(menu[0].label, 'Start at login'); assert.equal(menu[0].type, 'checkbox'); assert.equal(menu[0].checked, false);
  menu[0].click({ checked: true }); menu[0].click({ checked: false });
  assert.deepEqual(mac.calls, [{ openAtLogin: true }, { openAtLogin: false }]);
  assert.equal(trayMenuTemplate({ login: createLoginItem({ app: fakeApp(true, true), platform: 'darwin' }), quit: () => {} })[0].checked, true, 'the tick shows how it is now');
  assert.equal(createLoginItem({ app: fakeApp(true), platform: 'linux' }).available(), false);
});

test('Quit is on the right-click menu', () => {
  let quit = 0;
  const menu = trayMenuTemplate({ login: createLoginItem({ app: fakeApp(false) }), quit: () => { quit++; } });
  const q = menu.find((i) => i.label === QUIT_LABEL); q.click();
  assert.equal(quit, 1); assert.equal(QUIT_LABEL, 'Quit Menu Bar Chat');
});

test('PATH from the Finder: adds Homebrew and the usual places, keeps yours first, no repeats', () => {
  assert.equal(withCommonPaths('/usr/bin:/bin', '/Users/b'), '/usr/bin:/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/Users/b/.local/bin:/usr/sbin:/sbin');
  assert.ok(withCommonPaths('/my/tools:/opt/homebrew/bin', '/h').startsWith('/my/tools:/opt/homebrew/bin:/opt/homebrew/sbin'));
  assert.ok(withCommonPaths(undefined, '/h').startsWith('/opt/homebrew/bin'));
});

test('main.mjs: one data folder for both ways of running, right-click menu, PATH for the helper', () => {
  const src = read('app/main.mjs');
  const setPath = src.indexOf("app.setPath('userData', path.join(app.getPath('appData'), 'menubar-chat'))");
  assert.ok(setPath > 0 && setPath < src.indexOf('requestSingleInstanceLock'), 'set before anything uses the folder');
  assert.match(src, /mb\.tray\.on\('right-click', \(\) => mb\.tray\.popUpContextMenu\(Menu\.buildFromTemplate\(trayMenuTemplate\(\{ login, quit: \(\) => app\.quit\(\) \}\)\)\)\)/);
  assert.match(src, /PATH: withCommonPaths\(process\.env\.PATH, app\.getPath\('home'\)\)/);
  assert.match(read('app/window/usage-panel.js'), /Right-click the menu bar icon to quit/);
});
