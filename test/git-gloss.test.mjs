import test from 'node:test';
import assert from 'node:assert/strict';
import { explainToolCall } from '../shared/explain.mjs';

// Bromo's repo setup card listed four steps as "Run a git command". Each now says what it does.
test('git steps in a repo setup each get their own plain name', () => {
  const cmd = 'git init -b main && printf \'node_modules/\\n\' > .gitignore && git add -A && git commit -q -m "Initial" && git remote add origin https://github.com/x/y.git && git push -u origin main 2>&1 | tail -5; git rev-parse --show-toplevel; git status -sb | head -3; git ls-files | wc -l';
  const says = explainToolCall('Bash', { command: cmd }, '/Users/bromo/first-build').items.map((i) => i.say);
  assert.ok(!says.some((s) => /Run a git command/.test(s)), says.join(' | '));
  for (const want of [/^Start saving versions/, /^Link this folder/, /^Upload your commits/, /^Check where this repository starts/, /^List the files git is saving/, /^Write a file/])
    assert.ok(says.some((s) => want.test(s)), `${want} in ${says.join(' | ')}`);
});

test('git ls-remote reads an online repository', () => {
  const says = explainToolCall('Bash', { command: 'git ls-remote https://github.com/x/y.git' }, '/p').items.map((i) => i.say);
  assert.match(says[0], /^Check what an online repository holds/);
});
