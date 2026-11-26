// Bromo, Nov 26: "i want that repo/folder to show up in the dropdown like the others and the ability
// to add repos to that drop down". Add from GitHub copies the repo into ~/GitHub/<name> and adds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseRepo, folderFor, cloneRepo, cloneError } from '../app/github.mjs';
import { createProjects } from '../app/project-ipc.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-gh-'));
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('repo names: owner/name and GitHub links pass, paths and tricks do not', () => {
  for (const s of ['tiredofthissong/first-build', 'https://github.com/tiredofthissong/first-build', 'github.com/a-b/c.d_e.git', 'https://github.com/x/y/'])
    assert.ok(parseRepo(s), s);
  assert.deepEqual(parseRepo('https://github.com/tiredofthissong/first-build.git'), { owner: 'tiredofthissong', repo: 'first-build' });
  for (const s of ['', 'first-build', '../x/y', 'a/..', 'a/.', '/etc/passwd', 'a/b/c', 'https://evil.com/a/b', 'a b/c', '-x/y', 'x/y;rm', 'git@github.com:a/b', 'https://github.com/a/b?x=1'])
    assert.equal(parseRepo(s), null, s);
  assert.equal(folderFor('/Users/b', { owner: 'o', repo: 'first-build' }), '/Users/b/GitHub/first-build');
});

test('clone errors read as plain words', () => {
  assert.match(cloneError('fatal: could not read Username for https://github.com'), /sign-in/);
  assert.match(cloneError('remote: Repository not found.'), /couldn't find/);
  assert.match(cloneError('Could not resolve host: github.com'), /internet/);
});

function fakeIpc() { const h = {}; return { h, ipcMain: { handle: (n, fn) => { h[n] = fn; } } }; }

test('Add from GitHub: copies once into ~/GitHub, adds it as Personal, and reuses it next time', async () => {
  const home = tmp(); const src = path.join(tmp(), 'first-build');
  fs.mkdirSync(src); execFileSync('git', ['init', '-q', '-b', 'main', src]);
  fs.writeFileSync(path.join(src, 'SPEC.md'), 'garden'); execFileSync('git', ['-C', src, 'add', '-A']);
  execFileSync('git', ['-C', src, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x']);
  // A stand-in for GitHub: the real clone code runs, pointed at a local repo instead of github.com.
  const git = (args, cwd) => new Promise((res) => {
    const a = args[0] === 'clone' ? ['clone', '--quiet', src, args.at(-1)] : args;
    try { res({ ok: true, out: execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), err: '' }); } catch (e) { res({ ok: false, out: '', err: String(e.stderr) }); }
  });
  const clone = async (ref, h) => { const r = await cloneRepo(ref, h, git); if (r.ok && !r.reused) execFileSync('git', ['-C', r.folder, 'remote', 'set-url', 'origin', `https://github.com/${ref.owner}/${ref.repo}.git`]); return r; };
  const { h, ipcMain } = fakeIpc(); const userFile = path.join(home, 'projects.json');
  createProjects({ ipcMain, dialog: {}, window: () => null, fromOurWindow: () => true, home, userFile, scratchFile: path.join(home, 'none.json'), onChange: () => {}, clone });
  const r = await h['projects:github']({}, 'https://github.com/tiredofthissong/first-build');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.added, 'first-build');
  assert.deepEqual(r.projects.map((p) => [p.name, p.tag]), [['first-build', 'personal']], 'GitHub repos are Personal');
  assert.ok(fs.existsSync(path.join(home, 'GitHub', 'first-build', 'SPEC.md')));
  assert.equal(JSON.parse(fs.readFileSync(userFile, 'utf8'))[0].path, path.join(home, 'GitHub', 'first-build'));
  const again = await h['projects:github']({}, 'tiredofthissong/first-build');
  assert.equal(again.ok, true); assert.equal(again.projects.length, 1, 'no second copy');
  assert.equal((await h['projects:github']({}, '../../etc')).ok, false);
});

test('a folder already holding another repo is left alone', async () => {
  const home = tmp(); const dest = path.join(home, 'GitHub', 'site'); fs.mkdirSync(dest, { recursive: true });
  const r = await cloneRepo({ owner: 'me', repo: 'site' }, home, async () => ({ ok: false, out: '', err: 'not a git repo' }));
  assert.equal(r.ok, false); assert.match(r.error, /already holds something else/);
  assert.ok(fs.existsSync(dest), 'nothing deleted');
});

test('a failed clone leaves no half-copied folder', async () => {
  const home = tmp();
  const r = await cloneRepo({ owner: 'me', repo: 'gone' }, home, async (args) => { fs.mkdirSync(args.at(-1), { recursive: true }); return { ok: false, out: '', err: 'remote: Repository not found.' }; });
  assert.equal(r.ok, false); assert.match(r.error, /couldn't find/);
  assert.equal(fs.existsSync(path.join(home, 'GitHub', 'gone')), false);
});

test('the window sends only the typed repo, never a path, and git never prompts', () => {
  assert.match(read('app/preload.cjs'), /addGithub: \(repo\) => ipcRenderer\.invoke\('projects:github', String\(repo\)\.slice\(0, 300\)\)/);
  assert.match(read('app/github.mjs'), /GIT_TERMINAL_PROMPT: '0'/);
  assert.match(read('app/window/panel.js'), /Add from GitHub/);
});
