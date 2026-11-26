// Change cards and Undo: never write over newer work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ChangeStore, describe, insideProject } from '../changes/changes.mjs';
import { makePreToolUseHook } from '../policy/hook.mjs';
import { tempProject } from './support.mjs';

const hunk = (lines) => [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines }];

test('one plain sentence per change, with Claude\'s why', () => {
  assert.equal(describe('a.md', hunk(['-x', '+y']), false, 'fix the date.'), 'Changed 1 line in a.md. Why: fix the date.');
  assert.equal(describe('a.md', hunk(['+y', '+z']), false, null), "Added 2 lines in a.md. Claude didn't say why.");
  assert.equal(describe('a.md', hunk(['-x', '-y', '+z']), false, 'tidy'), 'Changed 1 line and removed 1 line in a.md. Why: tidy.');
  assert.equal(describe('new.md', hunk(['+a']), true, 'start notes'), 'Created new.md. Why: start notes.');
  assert.equal(describe('a.md', [], false, null), "Changed in a.md. Claude didn't say why.");
});

test('undo puts an edited file back; a created file is removed', (t) => {
  const dir = tempProject(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ChangeStore(dir); const notes = path.join(dir, 'notes.txt');
  assert.equal(store.snapshotBefore('t1', 'notes.txt'), true);
  fs.writeFileSync(notes, 'edited');
  const card = store.recordAfter('t1', { hunks: hunk(['-a', '+b']), why: 'typo' });
  assert.deepEqual([card.id, card.file, card.canUndo], ['t1', 'notes.txt', true]);
  assert.equal(store.undo('t1').ok, true);
  assert.match(fs.readFileSync(notes, 'utf8'), /teh notes/);

  store.snapshotBefore('t2', 'fresh.md');
  fs.writeFileSync(path.join(dir, 'fresh.md'), 'hi');
  store.recordAfter('t2', {});
  assert.equal(store.undo('t2').ok, true);
  assert.equal(fs.existsSync(path.join(dir, 'fresh.md')), false);
});

test('undo refuses if the file changed since, or if there is nothing to undo', (t) => {
  const dir = tempProject(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ChangeStore(dir); const notes = path.join(dir, 'notes.txt');
  store.snapshotBefore('t1', notes);
  fs.writeFileSync(notes, 'claude wrote this');
  store.recordAfter('t1', {});
  fs.writeFileSync(notes, 'and then you wrote this');
  const r = store.undo('t1');
  assert.deepEqual([r.ok, r.code], [false, 'changed-since']);
  assert.equal(fs.readFileSync(notes, 'utf8'), 'and then you wrote this');
  assert.equal(store.undo('nope').code, 'nothing');
  store.snapshotBefore('t3', notes); store.forget('t3');
  assert.equal(store.recordAfter('t3', {}), null, 'a denied edit leaves no card');
});

test('files outside the project folder get no copy (and so no Undo), symlinks included', (t) => {
  const dir = tempProject(); const other = tempProject();
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true }); });
  fs.symlinkSync(other, path.join(dir, 'link'));
  assert.equal(insideProject(dir, '../x.txt'), null);
  assert.equal(insideProject(dir, path.join(other, 'notes.txt')), null);
  assert.equal(insideProject(dir, 'link/notes.txt'), null, 'a symlink out of the folder is outside');
  assert.ok(insideProject(dir, 'sub/new.txt').endsWith(path.join('sub', 'new.txt')));
  const store = new ChangeStore(dir);
  assert.equal(store.snapshotBefore('t1', '../x.txt'), false);
  assert.equal(store.recordAfter('t1', {}), null);
});

test('the hook copies a file before an edit, and blocks the edit if it cannot', async (t) => {
  const dir = tempProject(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ChangeStore(dir);
  const hook = makePreToolUseHook({ project: { tag: 'personal', path: dir }, changes: store });
  const call = (file) => hook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file } }, 'toolu_1');
  assert.deepEqual(await call('notes.txt'), {});
  assert.equal(store.items.get('toolu_1').before, 'I wrote teh notes.\nSecond line.\n');
  fs.mkdirSync(path.join(dir, 'folder'));
  await assert.rejects(call('folder'), 'a copy that fails throws, so onFailure "block" stops the edit');
});
