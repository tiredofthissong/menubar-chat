// Bromo, Nov 26 (his notes on the TimeCapsuleSMB app): one Checkup panel, rows grouped by place,
// and "every error in our app ends with its fix, using the exact name of the button that fixes it".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runCheckup, createCheckup, KEYCHAIN_COMMAND } from '../app/checkup.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const gh = (r) => async () => r;
const work = { name: 'work-demo', tag: 'work', path: '/x/work-demo', pushBlock: 'off' };

test('all good: everything passes, one plain line, nothing to fix', async () => {
  const r = await runCheckup({ keyOk: true, helperOk: true, spent: 1, cap: 5, project: { ...work, pushBlock: 'on' },
    github: gh({ ok: true, repos: [{}, {}] }), exists: () => true });
  assert.equal(r.verdict, 'pass'); assert.equal(r.summary, 'Everything checked out.');
  assert.deepEqual(r.groups.map((g) => g.name), ['This Mac', 'work-demo']);
  assert.equal(r.counts.fail + r.counts.warn, 0);
  assert.match(r.groups[0].rows[2].text, /2 of your repos/);
});

test('problems: each one ends with the button or step that fixes it', async () => {
  const r = await runCheckup({ keyOk: false, helperOk: false, spent: 5, cap: 5, project: work,
    github: gh({ ok: false, error: "This Mac's git isn't signed in to GitHub yet" }), exists: () => false });
  assert.equal(r.verdict, 'fail'); assert.match(r.summary, /^4 problems to fix\.$/);
  const rows = Object.fromEntries(r.groups.flatMap((g) => g.rows).map((x) => [x.label, x]));
  assert.match(rows['API key'].text, /Press Copy command/); assert.equal(rows['API key'].copy, KEYCHAIN_COMMAND);
  assert.doesNotMatch(KEYCHAIN_COMMAND, / -w \S/, 'the command asks for the key; no key is ever in it');
  assert.match(rows['Background helper'].text, /Press Send/);
  assert.match(rows.GitHub.text, /press Run checkup/); assert.equal(rows.GitHub.status, 'warn');
  assert.match(rows['Push block'].text, /press Add push block/);
  assert.match(rows.Folder.text, /press Add a folder/); assert.equal(rows.Folder.detail, '/x/work-demo', 'the path waits behind Details');
  assert.equal(rows["Today's spend"].status, 'fail');
});

test('GitHub out of reach or refusing the sign-in, and a project put away', async () => {
  const off = await runCheckup({ keyOk: true, helperOk: true, spent: 0, cap: 5, project: { name: 'p', tag: 'personal', away: true },
    github: async () => { throw new Error('offline'); } });
  assert.match(off.groups[0].rows[2].text, /internet/); assert.match(off.groups[1].rows[0].text, /pick it to copy it back/);
  const refused = await runCheckup({ keyOk: true, helperOk: true, spent: 4, cap: 5, project: null, github: gh({ ok: false, error: "GitHub didn't accept" }) });
  assert.equal(refused.groups.length, 1); assert.equal(refused.groups[0].rows[2].status, 'fail'); assert.equal(refused.groups[0].rows[3].status, 'warn');
});

test('the checkup is read-only, answers our window only, and the panel shows no sign-in', async () => {
  const h = {};
  createCheckup({ ipcMain: { handle: (n, fn) => { h[n] = fn; } }, fromOurWindow: (e) => e === 'ours', keyOk: async () => true, helperOk: () => true,
    spend: () => ({ spent: 0, cap: 5 }), projects: () => ({ list: [work], view: () => [{ name: 'work-demo', pushBlock: 'on' }] }), github: gh({ ok: true, repos: [] }) });
  assert.equal((await h['checkup:run']('other', 'work-demo')).ok, false);
  const r = await h['checkup:run']('ours', 'work-demo');
  assert.equal(r.groups[1].rows.find((x) => x.label === 'Push block').status, 'pass');
  assert.doesNotMatch(read('app/checkup.mjs'), /writeFile|rmSync|unlink|spawn\(|trash/i, 'checks only look');
  const panel = read('app/window/checkup-panel.js');
  assert.doesNotMatch(panel, /innerHTML|token|password/i);
  assert.match(read('app/preload.cjs'), /checkup: \(project\) => ipcRenderer\.invoke\('checkup:run'/);
});

test('every problem message the app sends ends with what to do', () => {
  const texts = ['engine/session.mjs', 'engine/helper.mjs', 'engine/serve.mjs', 'app/helper-link.mjs', 'app/github.mjs', 'app/project-ipc.mjs', 'app/put-away.mjs']
    .map(read).join('\n');
  for (const fix of ['Press Send to start it again', 'Wait a few seconds, then try again', 'press Add from GitHub again', 'press Put away again', 'Pick it again in the mode menu']) {
    assert.ok(texts.includes(fix), fix);
  }
  assert.match(read('app/window/app.js'), /Press Open Checkup for the fix\.', true, openCheckup\)/, 'the missing-key note opens Checkup');
});
