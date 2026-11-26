// Bromo, Nov 26: "the add from github should auto-populate all avaiable repos including prviate in the
// dropdown ... they may be created in code app and i need to check they show". The list uses the
// GitHub sign-in this Mac's git already has, and the sign-in never leaves the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitToken, listRepos } from '../app/github-list.mjs';
import { createProjects } from '../app/project-ipc.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const json = (status, body) => ({ status, ok: status < 300, json: async () => body });
const repo = (n, priv = false) => ({ full_name: `tiredofthissong/${n}`, private: priv, pushed_at: '2026-11-26T22:00:00Z', owner: { login: 'x' } });

test('git sign-in: read from git\'s own credential helper, and empty (no prompt) when there is none', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-cred-'));
  const store = path.join(dir, 'creds'); const cfg = path.join(dir, 'gitconfig');
  fs.writeFileSync(cfg, `[credential]\n\thelper = store --file=${store}\n`);
  const saved = { ...process.env };
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' });
  try {
    fs.writeFileSync(store, 'https://me:secret-token@github.com\n');
    assert.equal(await gitToken(), 'secret-token');
    fs.writeFileSync(store, '');
    assert.equal(await gitToken(), '', 'no sign-in: nothing, and git never waits for a typed password');
  } finally { process.env = saved; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('repos: every page, private ones marked, newest first as GitHub sends them; the sign-in goes only to GitHub', async () => {
  const calls = [];
  const get = async (url, opts) => { calls.push({ url, auth: opts.headers.Authorization });
    return json(200, url.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => repo(`r${i}`, i === 0)) : [repo('last')]); };
  const r = await listRepos({ token: async () => 'tok', get });
  assert.equal(r.ok, true); assert.equal(r.repos.length, 101);
  assert.deepEqual(r.repos[0], { full: 'tiredofthissong/r0', private: true, pushed: '2026-11-26T22:00:00Z' });
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.ok(c.url.startsWith('https://api.github.com/user/repos?'), c.url);
    assert.match(c.url, /sort=pushed/); assert.match(c.url, /affiliation=owner,collaborator,organization_member/);
    assert.equal(c.auth, 'Bearer tok');
  }
  assert.doesNotMatch(JSON.stringify(r), /tok"/, 'the sign-in is not in what goes back to the window');
});

test('repos: plain words when there is no sign-in, GitHub refuses it, or GitHub is out of reach', async () => {
  let asked = false;
  const none = await listRepos({ token: async () => '', get: async () => { asked = true; } });
  assert.equal(none.ok, false); assert.match(none.error, /isn't signed in to GitHub/); assert.equal(asked, false);
  assert.match((await listRepos({ token: async () => 't', get: async () => json(401, {}) })).error, /didn't accept/);
  assert.match((await listRepos({ token: async () => 't', get: async () => json(500, {}) })).error, /Refresh/);
  assert.match((await listRepos({ token: async () => 't', get: async () => { throw new Error('offline'); } })).error, /internet/);
});

test('window gets names only, from our window only', async () => {
  const h = {}; const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-gl-'));
  createProjects({ ipcMain: { handle: (n, fn) => { h[n] = fn; } }, dialog: {}, window: () => null, fromOurWindow: (e) => e === 'ours', home,
    userFile: path.join(home, 'p.json'), scratchFile: path.join(home, 's.json'), onChange: () => {},
    repos: async () => ({ ok: true, repos: [{ full: 'a/b', private: true, pushed: null }] }) });
  assert.deepEqual(await h['projects:githubList']('ours'), { ok: true, repos: [{ full: 'a/b', private: true, pushed: null }] });
  assert.equal((await h['projects:githubList']('other')).ok, false);
  assert.match(read('app/preload.cjs'), /listGithub: \(\) => ipcRenderer\.invoke\('projects:githubList'\)/, 'the window sends nothing with the ask');
  const row = read('app/window/github-row.js');
  assert.doesNotMatch(row, /token|password|innerHTML/i);
  assert.match(row, /o\.disabled = added/, 'a repo already in the list can\'t be added twice');
  assert.match(row, /'Refresh'/); assert.match(row, /input\.value\.trim\(\) \|\| pick\.value/, 'typing still works for a repo that isn\'t listed');
  fs.rmSync(home, { recursive: true, force: true });
});
