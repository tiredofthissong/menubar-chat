import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { blockPushes, hookPath, MARKER } from '../scripts/block-pushes.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'menubar-test-'));
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

test('make-scratch builds both test projects and refuses to overwrite', () => {
  const root = path.join(tmp(), 'scratch');
  const run = () => execFileSync(process.execPath, ['scripts/make-scratch.mjs'], { env: { ...process.env, MENUBAR_SCRATCH: root }, encoding: 'utf8' });
  assert.match(run(), /Scratch folder ready/);
  const projects = JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8'));
  assert.deepEqual(projects.map((p) => [p.name, p.tag]), [['personal-demo', 'personal'], ['work-demo', 'work']]);
  assert.match(fs.readFileSync(path.join(root, 'personal-demo', 'notes.txt'), 'utf8'), /teh/);
  assert.ok(fs.existsSync(path.join(root, 'personal-demo', 'kit', 'demo-skill', 'SKILL.md')));
  for (const p of projects) assert.match(git(p.path, 'remote', 'get-url', 'origin'), /fake-github/);
  assert.throws(run, (err) => /already exists/.test(err.stdout) && err.status === 1);
});

test('block-pushes: refuses every push, leaves other hooks alone, and comes off cleanly', () => {
  const dir = tmp(); const bare = path.join(dir, 'remote.git'); const repo = path.join(dir, 'repo');
  git(dir, 'init', '--bare', '-q', '-b', 'main', bare);
  fs.mkdirSync(repo); git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 't'); git(repo, 'config', 'user.email', 't@example.invalid');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'a');
  git(repo, 'remote', 'add', 'origin', bare);

  assert.equal(blockPushes(repo).ok, true);
  assert.match(fs.readFileSync(hookPath(repo), 'utf8'), new RegExp(MARKER));
  assert.throws(() => git(repo, 'push', '-q', 'origin', 'main'), /Push blocked/);
  assert.match(blockPushes(repo).text, /already has the push block/);

  assert.equal(blockPushes(repo, { remove: true }).ok, true);
  git(repo, 'push', '-q', 'origin', 'main'); // works again

  fs.writeFileSync(hookPath(repo), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(blockPushes(repo).ok, false);
  assert.equal(blockPushes(repo, { remove: true }).ok, false);
  assert.equal(fs.readFileSync(hookPath(repo), 'utf8'), '#!/bin/sh\nexit 0\n');

  assert.equal(blockPushes(dir).ok, false, 'not a repo');
  assert.equal(blockPushes(path.join(dir, 'nope')).ok, false, 'no folder');
  assert.equal(blockPushes('').ok, false);
});
