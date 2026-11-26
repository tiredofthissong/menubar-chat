// Bromo, Nov 26: "love the put away idea". A project copied from GitHub can be put away: the app
// checks that nothing lives only on this Mac, moves the folder to the Trash, keeps the project in the
// list, and copies it back from GitHub when you pick it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { whyNotPutAway } from '../app/put-away.mjs';
import { cloneRepo } from '../app/github.mjs';
import { createProjects } from '../app/project-ipc.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-away-'));
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const GH = 'https://github.com/tiredofthissong/my-dashboard.git';

/** A bare repo standing in for GitHub, with one pushed commit. */
function remote() {
  const bare = path.join(tmp(), 'gh.git'); execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const seed = tmp(); g(seed, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(seed, '.gitignore'), 'node_modules/\ndata/raw/\n');
  fs.writeFileSync(path.join(seed, 'index.html'), '<p>hi</p>'); g(seed, 'add', '-A'); g(seed, 'commit', '-qm', 'first');
  g(seed, 'remote', 'add', 'origin', bare); g(seed, 'push', '-q', '-u', 'origin', 'main');
  return bare;
}
// The real git runs; only the origin's address reads as GitHub's, and clone points at the stand-in.
const gitFor = (bare, { offline = false } = {}) => (args, cwd) => new Promise((res) => {
  if (args.join(' ') === 'remote get-url origin') return res({ ok: true, out: GH, err: '' });
  if (offline && args[0] === 'fetch') return res({ ok: false, out: '', err: 'Could not resolve host' });
  const a = args[0] === 'clone' ? ['clone', '--quiet', bare, args.at(-1)] : args;
  try { res({ ok: true, out: g(cwd, ...a).trim(), err: '' }); } catch (e) { res({ ok: false, out: '', err: String(e.stderr) }); }
});
function copy(bare) { const dir = path.join(tmp(), 'my-dashboard'); execFileSync('git', ['clone', '-q', bare, dir]); return dir; }

test('put away is allowed only when everything is on GitHub', async () => {
  const bare = remote(); const git = gitFor(bare); const repo = 'tiredofthissong/my-dashboard';
  const dir = copy(bare);
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true }); fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'a.js'), '');
  assert.equal(await whyNotPutAway(dir, repo, git), null, 'pushed and clean; node_modules can be rebuilt');

  fs.writeFileSync(path.join(dir, 'index.html'), '<p>changed</p>');
  assert.match(await whyNotPutAway(dir, repo, git), /aren't on GitHub yet: index\.html/);
  g(dir, 'stash', '-q');
  assert.match(await whyNotPutAway(dir, repo, git), /git stash/);
  g(dir, 'stash', 'drop', '-q');

  fs.mkdirSync(path.join(dir, 'data', 'raw'), { recursive: true }); fs.writeFileSync(path.join(dir, 'data', 'raw', 'sales.csv'), 'a,b');
  assert.match(await whyNotPutAway(dir, repo, git), /only on this Mac, because git is set to skip them: data\/raw/);
  fs.rmSync(path.join(dir, 'data'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'b.txt'), 'b'); g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'two');
  assert.match(await whyNotPutAway(dir, repo, git), /branch main has snapshots that aren't on GitHub/);
  g(dir, 'push', '-q');
  assert.equal(await whyNotPutAway(dir, repo, git), null);

  g(dir, 'branch', 'idea');
  assert.match(await whyNotPutAway(dir, repo, git), /branch idea is only on this Mac/);
  g(dir, 'branch', '-q', '-D', 'idea');

  assert.match(await whyNotPutAway(dir, repo, gitFor(bare, { offline: true })), /Couldn't reach GitHub/);
  assert.match(await whyNotPutAway(dir, 'someone/else', git), /isn't linked to someone\/else/);
});

test('put away and copy back: the project stays in the list, Claude never gets a missing folder', async () => {
  const bare = remote(); const git = gitFor(bare);
  const home = tmp(); const bin = tmp(); const userFile = path.join(home, 'projects.json');
  const clone = (ref, h) => cloneRepo(ref, h, git);
  const trash = async (p) => fs.renameSync(p, path.join(bin, path.basename(p)));
  const make = () => { const h = {}; const changes = []; const p = createProjects({ ipcMain: { handle: (n, fn) => { h[n] = fn; } }, dialog: {}, window: () => null, fromOurWindow: () => true,
    home, userFile, scratchFile: path.join(home, 'none.json'), onChange: (l) => changes.push(l), clone, trash, check: (f, r) => whyNotPutAway(f, r, git) }); return { h, p, changes }; };
  const { h, p, changes } = make();
  const added = await h['projects:github']({}, 'tiredofthissong/my-dashboard');
  assert.equal(added.ok, true, added.error);
  assert.equal(added.projects[0].repo, 'tiredofthissong/my-dashboard');
  const folder = path.join(home, 'GitHub', 'my-dashboard');

  const away = await h['projects:putAway']({}, 'my-dashboard');
  assert.equal(away.ok, true, away.error);
  assert.match(away.text, /safe on GitHub and its folder is in the Trash/);
  assert.ok(!fs.existsSync(folder) && fs.existsSync(path.join(bin, 'my-dashboard')), 'moved to the Trash, not deleted');
  assert.deepEqual(away.projects.map((x) => [x.name, x.away]), [['my-dashboard', true]]);
  assert.deepEqual(p.list, [], 'Claude only gets folders that are on this Mac');
  assert.deepEqual(changes.at(-1), []);
  const saved = JSON.parse(fs.readFileSync(userFile, 'utf8'));
  assert.equal(saved[0].repo, 'tiredofthissong/my-dashboard'); assert.equal(saved[0].away, undefined, 'away is worked out, never saved');

  const later = make(); // the app opened again
  assert.deepEqual(later.p.view().map((x) => [x.name, x.away]), [['my-dashboard', true]], 'still in the list after a restart');
  assert.equal((await later.h['projects:putAway']({}, 'my-dashboard')).ok, false);
  const back = await later.h['projects:bringBack']({}, 'my-dashboard');
  assert.equal(back.ok, true, back.error); assert.match(back.text, /Copied my-dashboard back/);
  assert.ok(fs.existsSync(path.join(folder, 'index.html')));
  assert.deepEqual(later.p.list.map((x) => x.name), ['my-dashboard']);
  assert.equal((await later.h['projects:bringBack']({}, 'my-dashboard')).ok, false, 'already here');

  fs.writeFileSync(path.join(folder, 'notes.md'), 'draft');
  const blocked = await later.h['projects:putAway']({}, 'my-dashboard');
  assert.equal(blocked.ok, false); assert.match(blocked.error, /notes\.md/); assert.ok(fs.existsSync(folder), 'nothing moved');
  fs.rmSync(path.join(folder, 'notes.md'));
  await later.h['projects:tag']({}, 'my-dashboard', 'work');
  assert.match((await later.h['projects:putAway']({}, 'my-dashboard')).error, /personal projects/);
});

test('folders added by hand are never put away, and the window wires it all up', async () => {
  const home = tmp(); const h = {};
  createProjects({ ipcMain: { handle: (n, fn) => { h[n] = fn; } }, dialog: {}, window: () => null, fromOurWindow: () => true, home,
    userFile: path.join(home, 'p.json'), scratchFile: path.join(home, 'n.json'), onChange: () => {}, trash: async () => { throw new Error('must not run'); } });
  assert.equal((await h['projects:putAway']({}, 'nope')).ok, false);
  assert.match(read('app/preload.cjs'), /putAway:.*projects:putAway/);
  assert.match(read('app/preload.cjs'), /bringBack:.*projects:bringBack/);
  assert.match(read('app/main.mjs'), /trash: \(p\) => shell\.trashItem\(p\)/);
  const panel = read('app/window/panel.js');
  assert.match(panel, /'on GitHub'/); assert.match(panel, /'Keep it here', 'Put away'/); assert.match(panel, /ctx\.busy\(p\.name\)/);
  assert.match(read('app/window/app.js'), /find\(\(x\) => !x\.away\)/);
});
