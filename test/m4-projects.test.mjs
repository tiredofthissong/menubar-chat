// Milestone 4: projects, Work or Personal, the push block and the usage panel. The guard tests run
// real git in a throwaway repo with a throwaway remote, so a push that got through would show up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { loadProjects, refuseFolder, addProject, setTag, nameFor } from '../app/projects.mjs';
import { createProjects } from '../app/project-ipc.mjs';
import { blockPushes, pushBlockState, MARKER } from '../scripts/block-pushes.mjs';
import { checkToolCall } from '../policy/rules.mjs';
import { pastTurns } from '../engine/translate.mjs';
import { createHelper } from '../engine/helper.mjs';
import { Budget } from '../usage/budget.mjs';
import { KEYCHAIN_SERVICE } from '../engine/options.mjs';
import { silentLogger } from '../shared/log.mjs';
import { createFakeClaude } from '../mock/fake-claude.mjs';
import { tempProject, collector } from './support.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-m4-'));
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const memFs = (files, folders) => ({ read: (f) => { if (!(f in files)) throw new Error('none'); return files[f]; }, exists: (p) => folders.includes(p) });

test('project list: your own list wins, untagged counts as Work, bad entries are left out', () => {
  const files = {
    '/u.json': JSON.stringify([{ name: 'site', path: '/p/site', tag: 'personal' }, { name: '../evil', path: '/p/x' }, { name: 'gone', path: '/p/gone' }]),
    '/s.json': JSON.stringify([{ name: 'site', path: '/p/other' }, { name: 'dup', path: '/p/site' }, { name: 'plain', path: '/p/plain' }]),
  };
  const list = loadProjects(['/u.json', '/s.json', '/missing.json'], memFs(files, ['/p/site', '/p/x', '/p/other', '/p/plain']));
  assert.deepEqual(list, [{ name: 'site', path: '/p/site', tag: 'personal' }, { name: 'plain', path: '/p/plain', tag: 'work' }]);
  assert.equal(setTag(list, 'plain', 'banana')[1].tag, 'work', 'anything but personal is Work');
  assert.equal(setTag(list, 'plain', 'personal')[1].tag, 'personal');
});

test('adding a folder: home, the disk, system and key folders are refused; names stay unique', () => {
  const home = '/Users/b'; const list = [{ name: 'site', path: '/Users/b/code/site', tag: 'work' }];
  for (const bad of ['/', home, '/Users', '/System/Library', '/Users/b/.ssh', '/Users/b/Library/Keychains', '/Users/b/code/site']) {
    assert.ok(refuseFolder(bad, { home, list }), bad);
  }
  assert.equal(refuseFolder('/Users/b/code/blog', { home, list }), null);
  const two = addProject(list, '/Users/b/other/site', 'personal');
  assert.deepEqual(two[1], { name: 'site 2', path: '/Users/b/other/site', tag: 'personal' });
  assert.equal(nameFor('/x/$$$', []), 'project');
});

function fakeIpc(folder) {
  const handlers = {};
  return {
    handlers, ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [folder] }) },
  };
}

test('window actions: the folder comes only from the Mac picker, and the push block is for work only', async (t) => {
  const dir = tmp(); const repo = path.join(dir, 'client-site'); fs.mkdirSync(repo); git(repo, 'init', '-q');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = fakeIpc(repo); const changes = []; const ours = { sender: 'ours' };
  createProjects({ ...f, window: () => null, fromOurWindow: (e) => e === ours, home: '/nowhere', userFile: path.join(dir, 'u', 'projects.json'), scratchFile: path.join(dir, 's.json'), onChange: (l) => changes.push(l) });
  const h = (ch, ...a) => f.handlers[ch](ours, ...a);
  assert.deepEqual(await f.handlers['projects:pick']({ sender: 'someone else' }), { ok: false, error: 'not from this window' });
  assert.equal((await h('projects:add', 'work')).ok, false, 'nothing to add before the picker');
  assert.deepEqual(await h('projects:pick'), { ok: true, folder: 'client-site' });
  const added = await h('projects:add', 'personal');
  assert.equal(added.added, 'client-site'); assert.deepEqual(added.projects, [{ name: 'client-site', tag: 'personal', repo: null, away: false, pushBlock: null }]);
  assert.equal((await h('projects:block', 'client-site')).ok, false, 'no push block on a personal project');
  const work = await h('projects:tag', 'client-site', 'work');
  assert.equal(work.projects[0].pushBlock, 'off');
  const blocked = await h('projects:block', 'client-site');
  assert.equal(blocked.ok, true); assert.doesNotMatch(blocked.text, new RegExp(dir), 'the window sees the name, not the path');
  assert.equal(blocked.projects[0].pushBlock, 'on');
  assert.equal(changes.at(-1)[0].tag, 'work', 'the background helper hears about the new tag');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'u', 'projects.json'), 'utf8'))[0].tag, 'work');
});

test('guard: with the push block on, a push hidden in a script or a git alias never reaches GitHub', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const remote = path.join(dir, 'remote.git'); const repo = path.join(dir, 'work-repo');
  git(dir, 'init', '-q', '--bare', remote); fs.mkdirSync(repo); git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.com'); git(repo, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hi\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'one');
  git(repo, 'remote', 'add', 'origin', remote);
  assert.equal(pushBlockState(repo), 'off'); assert.equal(pushBlockState(dir), 'not-git');
  assert.equal(blockPushes(repo).ok, true); assert.equal(pushBlockState(repo), 'on');
  fs.writeFileSync(path.join(repo, 'ship.sh'), '#!/bin/sh\ngit push origin HEAD:main\n');
  git(repo, 'config', 'alias.ship', 'push origin HEAD:main');
  for (const [cmd, args] of [['sh', ['ship.sh']], ['git', ['ship']], ['git', ['push', '--force', 'origin', 'HEAD:main']]]) {
    const r = spawnSync(cmd, args, { cwd: repo, encoding: 'utf8' });
    assert.notEqual(r.status, 0, `${cmd} ${args.join(' ')} was refused`); assert.match(r.stderr, new RegExp(MARKER));
  }
  assert.equal(git(remote, 'for-each-ref').trim(), '', 'nothing reached the remote');
  assert.match(blockPushes(repo).text, /already has the push block/);
  fs.writeFileSync(path.join(repo, '.git', 'hooks', 'pre-push'), '#!/bin/sh\nexit 0\n');
  assert.equal(pushBlockState(repo), 'other'); assert.equal(blockPushes(repo).ok, false, 'someone else\'s hook is left alone');
});

test('guard: in a work project gh, git push in any form, GitHub and the personal hub are blocked', () => {
  const work = { project: { tag: 'work', path: '/w' }, hubPaths: ['/hub'] };
  const blocked = [
    ['Bash', { command: 'gh pr create --fill' }], ['Bash', { command: 'git -C . push origin main' }], ['Bash', { command: 'bash -c "git push"' }],
    ['Bash', { command: 'GIT_TRACE=1 git push' }], ['mcp__github__push_files', {}], ['mcp__hub-mcp__write_file', { path: 'notes.md' }],
    ['Write', { file_path: '/hub/claude-personal/x.md' }], ['Bash', { command: 'cp a.txt /hub/notes/' }],
  ];
  for (const [tool, input] of blocked) assert.equal(checkToolCall(work, tool, input).decision, 'deny', `${tool} ${JSON.stringify(input)}`);
  assert.equal(checkToolCall({ project: { path: '/w' } }, 'Bash', { command: 'gh repo view' }).decision, 'deny', 'untagged counts as Work');
  const personal = { project: { tag: 'personal', path: '/p' }, hubPaths: ['/hub'] };
  assert.equal(checkToolCall(personal, 'Bash', { command: 'git push' }).decision, 'ask', 'personal: a card asks you first');
});

test('past chats: what you typed and what Claude wrote, without tool output or system notes', () => {
  const turns = pastTurns([
    { type: 'user', message: { content: 'Fix the typo' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }, { type: 'tool_use', name: 'Edit' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'user', message: { content: '<command-name>/clear</command-name>' } },
    { type: 'assistant', parent_tool_use_id: 'x', message: { content: [{ type: 'text', text: 'sub-agent' }] } },
    { type: 'system', subtype: 'init' },
  ]);
  assert.deepEqual(turns, [{ who: 'you', text: 'Fix the typo' }, { who: 'claude', text: 'Done.' }]);
  assert.equal(pastTurns(Array.from({ length: 60 }, (_, i) => ({ type: 'user', message: { content: `m${i}` } }))).length, 40);
});

function helperFor(t, projects, extra = {}) {
  const c = collector();
  const helper = createHelper({
    projects, sdk: { query, ...extra }, budget: new Budget(5), log: silentLogger, send: c.push,
    settings: { keychainService: KEYCHAIN_SERVICE, hubPaths: ['~/claude-hub'], spawn: (o) => createFakeClaude(o) },
  });
  t.after(() => helper.shutdown());
  return { c, helper };
}

test('a tag change takes effect at once: the open chat closes and a waiting card is denied', async (t) => {
  const dir = tempProject(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = { name: 'site', path: dir, tag: 'personal' };
  const { c, helper } = helperFor(t, [p]);
  await helper.handleCommand({ type: 'send', project: 'site', text: '#edit' });
  await c.next((e) => e.type === 'approval');
  helper.setProjects([{ ...p, tag: 'work' }]);
  const closed = await c.next((e) => e.type === 'approval_closed');
  assert.equal(closed.decision, 'deny'); assert.equal(helper.pendingCards(), 0);
  assert.match(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), /teh/, 'nothing changed');
  helper.setProjects([]);
  assert.deepEqual(await helper.handleCommand({ type: 'send', project: 'site', text: 'hi' }), { ok: false, error: 'There is no project by that name.' });
});

test('picking up a past chat sends its turns to the window, without "Next:" lines', async (t) => {
  const dir = tempProject(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const asked = [];
  const { c, helper } = helperFor(t, [{ name: 'site', path: dir, tag: 'work' }], {
    getSessionMessages: async (id, o) => { asked.push([id, o.dir]); return [{ type: 'user', message: { content: 'hello' } }, { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi.\nNext: Run the tests' }] } }]; },
  });
  const sid = '0b8a5f2e-5a8e-4d43-9a3e-2d1c4b5a6f70';
  assert.deepEqual(await helper.handleCommand({ type: 'resume', project: 'site', sessionId: sid }), { ok: true });
  const past = await c.next((e) => e.type === 'past');
  assert.deepEqual(past.turns, [{ who: 'you', text: 'hello' }, { who: 'claude', text: 'Hi.' }]);
  assert.deepEqual(asked, [[sid, dir]]);
  assert.equal((await c.next((e) => e.type === 'session')).sessionId, sid);
});

test('window: one project button with a panel, Esc closes the panel first, usage in the panel', () => {
  const html = read('app/window/index.html'); const app = read('app/window/app.js'); const panel = read('app/window/panel.js');
  assert.doesNotMatch(html, /<select id="project/, 'the project picker is a button and a panel now');
  assert.match(html, /id="project"[^>]*aria-controls="panel-projects"/); assert.match(html, /id="spend"[^>]*aria-controls="panel-usage"/);
  assert.match(app, /if \(Panel\.close\(\)\) return;[\s\S]*api\.hide\(\)/);
  assert.match(app, /case 'past': Log\.reset\(p\); Log\.past\(p/);
  assert.doesNotMatch(panel, /innerHTML/);
  assert.match(panel, /'Add push block', async \(\) =>/, 'the push block runs only after the second, in-panel answer');
  assert.doesNotMatch(panel, /button\('(Remove|Turn off|Allow|Override)/i, 'no button turns the work block off');
  assert.match(panel, /confirm\(s, `Make "\$\{p\.name\}" personal\?/, 'making a work project personal asks first');
  assert.doesNotMatch(read('app/preload.cjs'), /addFolder: \(.*folder/, 'the window never hands the app a path');
});
