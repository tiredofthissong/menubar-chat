import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { checkToolCall, runsGitPush, denyRules, isStrict } from '../policy/rules.mjs';

const work = { tag: 'work', path: '/tmp/work-demo' };
const personal = { tag: 'personal', path: '/tmp/personal-demo' };
const untagged = { path: '/tmp/x' };
const hubPaths = ['~/claude-hub'];
const bash = (project, command) => checkToolCall({ project, hubPaths }, 'Bash', { command });

test('every way of writing git push is caught', () => {
  for (const c of ['git push', 'git push origin main', 'git -C . push', 'git -c a=b push', '/usr/bin/git push',
    'echo hi && git push', 'ls; git push', 'git status || git push', 'GIT_TRACE=1 git push', 'sh -c "git push"',
    'bash -c \'git push origin\'', 'eval git push', 'git --git-dir=.git --work-tree=. push', 'git --no-pager push']) {
    assert.equal(runsGitPush(c), true, c);
  }
  for (const c of ['git status', 'git commit -m "push it"', 'echo push', 'git log --grep push', 'npm run push-notes']) {
    assert.equal(runsGitPush(c), false, c);
  }
});

test('work projects: push, gh, remote changes, GitHub and hub connectors are blocked', () => {
  assert.equal(bash(work, 'git add . && git commit -m x && git push origin main').rule, 'work-publish');
  assert.equal(bash(work, 'gh pr create').rule, 'work-publish');
  assert.equal(bash(work, 'git remote add other https://example.invalid/x.git').rule, 'work-publish');
  assert.equal(bash(work, 'git remote set-url origin x').rule, 'work-publish');
  assert.equal(checkToolCall({ project: work, hubPaths }, 'mcp__github__push_files', {}).rule, 'work-connector');
  assert.equal(checkToolCall({ project: work, hubPaths }, 'mcp__hub-mcp__write_file', {}).rule, 'work-connector');
  const hubFile = path.join(os.homedir(), 'claude-hub', 'notes.md');
  assert.equal(checkToolCall({ project: work, hubPaths }, 'Write', { file_path: hubFile }).rule, 'work-to-hub');
  assert.equal(bash(work, 'cp notes.txt ~/claude-hub/').rule, 'work-to-hub');
});

test('untagged projects are treated as work', () => {
  assert.equal(isStrict(untagged), true);
  assert.equal(isStrict(undefined), true);
  assert.equal(bash(untagged, 'git push').decision, 'deny');
});

test('personal projects may push, but still get a card (never auto-allowed)', () => {
  assert.deepEqual(bash(personal, 'git push origin main'), { decision: 'ask' });
  assert.deepEqual(checkToolCall({ project: personal, hubPaths }, 'mcp__github__push_files', {}), { decision: 'ask' });
});

test('secret files are blocked everywhere', () => {
  for (const project of [work, personal]) {
    assert.equal(checkToolCall({ project }, 'Read', { file_path: '.env' }).rule, 'secret-file');
    assert.equal(checkToolCall({ project }, 'Read', { file_path: '.env.local' }).rule, 'secret-file');
    assert.equal(checkToolCall({ project }, 'Read', { file_path: '~/.ssh/id_ed25519' }).rule, 'secret-file');
    assert.equal(checkToolCall({ project }, 'Read', { file_path: '~/.aws/credentials' }).rule, 'secret-file');
    assert.equal(checkToolCall({ project }, 'Bash', { command: 'cat .env' }).rule, 'secret-file');
  }
  assert.equal(checkToolCall({ project: personal }, 'Read', { file_path: '.env.example' }).decision, 'ask');
});

test('checkToolCall never returns allow', () => {
  const calls = [['Bash', { command: 'ls' }], ['Read', { file_path: 'README.md' }], ['Edit', { file_path: 'notes.txt' }], ['WebFetch', { url: 'https://x' }]];
  for (const project of [work, personal, untagged]) for (const [t, i] of calls) assert.notEqual(checkToolCall({ project, hubPaths }, t, i).decision, 'allow');
});

test('deny rules: strict projects get the push and connector rules', () => {
  const w = denyRules({ project: work, hubPaths });
  assert.ok(w.includes('Bash(git push *)') && w.includes('mcp__github__*') && w.includes('mcp__hub-mcp__*'));
  assert.ok(w.some((r) => r.startsWith('Edit(//') && r.includes('claude-hub')));
  const p = denyRules({ project: personal, hubPaths });
  assert.ok(!p.includes('Bash(git push *)'));
  assert.ok(p.includes('Read(./.env)'));
});
