// checkup.mjs - the checks behind the Checkup panel, done by the app itself. Every check only looks:
// nothing changes, and the GitHub sign-in never leaves the app (github-list.mjs).
// Each row is one plain sentence, and a problem ends with the exact button or step that fixes it.
// (Bromo's notes on the TimeCapsuleSMB app, Nov 26: title and pill, one line, one button, grouped rows.)
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { KEYCHAIN_SERVICE } from '../engine/options.mjs';
import { listRepos } from './github-list.mjs';

/** The one Terminal step there is no button for yet. It asks for the key itself; nothing is in it. */
export const KEYCHAIN_COMMAND = `security add-generic-password -s ${KEYCHAIN_SERVICE} -a "$USER" -w`;
const REOPEN = 'quit the app from the menu bar icon and open it again';

/** Asks only whether the Keychain item exists; without -w the secret itself is never printed. */
export const keychainHasKey = () => new Promise((resolve) => {
  execFile('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], (err) => resolve(!err));
});

const row = (status, label, text, more = {}) => ({ status, label, text, ...more });
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

function githubRow(g) {
  if (g.ok) return row('pass', 'GitHub', `This Mac is signed in to GitHub, and ${g.repos.length} of your repos can be added.`);
  if (/isn't signed in/.test(g.error)) {
    return row('warn', 'GitHub', 'This Mac isn\'t signed in to GitHub, so Add from GitHub and Put away can\'t work. '
      + 'Ask Claude in any project to sign this Mac in to GitHub, then press Run checkup.');
  }
  if (/didn't accept/.test(g.error)) {
    return row('fail', 'GitHub', 'GitHub didn\'t accept this Mac\'s sign-in. Ask Claude in any project to sign this Mac in to GitHub again, then press Run checkup.');
  }
  return row('warn', 'GitHub', 'Couldn\'t reach GitHub just now. Check your internet, then press Run checkup.');
}

function spendRow(spent, cap) {
  if (spent >= cap) return row('fail', 'Today\'s spend', `About ${money(spent)}, which reached the $${cap} daily cap, so Claude can't answer until midnight.`);
  if (spent >= cap * 0.8) return row('warn', 'Today\'s spend', `About ${money(spent)} of $${cap}, close to the cap. Spending stops at the cap and starts over at midnight.`);
  return row('pass', 'Today\'s spend', `About ${money(spent)} of $${cap} today.`);
}

function projectRows(p, exists) {
  if (p.away) return [row('info', 'Folder', 'Put away on GitHub. Open Projects and pick it to copy it back.')];
  const rows = [exists(p.path)
    ? row('pass', 'Folder', 'The folder is on this Mac.', { detail: p.path })
    : row('fail', 'Folder', 'The folder isn\'t where it was. Open Projects and press Add a folder to add it again.', { detail: p.path })];
  if (p.tag === 'personal') rows.push(row('info', 'Kind', 'Personal: a GitHub push asks you first on a card.'));
  else rows.push(row('pass', 'Kind', 'Work: GitHub pushes and your personal hub are blocked.'));
  if (p.tag !== 'personal') {
    rows.push({
      on: row('pass', 'Push block', 'On: git refuses every push from this folder.'),
      off: row('warn', 'Push block', 'Off. Open Projects and press Add push block.'),
      other: row('warn', 'Push block', 'This repo has its own pre-push hook, so the push block was left off. Ask Claude in this project to combine them.'),
      'not-git': row('info', 'Push block', 'Not a git repo, so there is nothing to push.'),
    }[p.pushBlock] || row('info', 'Push block', 'Not checked.'));
  }
  return rows;
}

/**
 * @param {{ keyOk: boolean, helperOk: boolean, spent: number, cap: number, project: object|null,
 *   github?: () => Promise<object>, exists?: (p: string) => boolean }} d
 */
export async function runCheckup({ keyOk, helperOk, spent, cap, project, github = () => listRepos(), exists = (p) => fs.existsSync(p) }) {
  const mac = [
    keyOk ? row('pass', 'API key', 'Your API key is in the Keychain.')
      : row('fail', 'API key', `No API key in the Keychain, so Claude can't answer. Press Copy command, paste it in Terminal and paste your key when it asks, then ${REOPEN}.`, { copy: KEYCHAIN_COMMAND }),
    helperOk ? row('pass', 'Background helper', 'Running, so Claude Code can start in any project.')
      : row('fail', 'Background helper', `Not running. Press Send in any project to start it again, or ${REOPEN}.`),
    githubRow(await github().catch(() => ({ ok: false, error: '' }))),
    spendRow(spent, cap),
  ];
  const groups = [{ name: 'This Mac', rows: mac }];
  if (project) groups.push({ name: project.name, rows: projectRows(project, exists) });
  const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const g of groups) for (const r of g.rows) counts[r.status] += 1;
  const s = (n) => (n === 1 ? '' : 's');
  const summary = counts.fail ? `${counts.fail} problem${s(counts.fail)} to fix.`
    : counts.warn ? `${counts.warn} thing${s(counts.warn)} to look at.` : 'Everything checked out.';
  return { ok: true, groups, counts, summary, verdict: counts.fail ? 'fail' : counts.warn ? 'warn' : 'pass' };
}

/** The panel asks with a project name only; the app looks the project up itself. */
export function createCheckup({ ipcMain, fromOurWindow, keyOk = keychainHasKey, helperOk, spend, projects, github }) {
  ipcMain.handle('checkup:run', async (e, name) => {
    if (!fromOurWindow(e)) return { ok: false, error: 'not from this window' };
    const p = projects().list.find((x) => x.name === name);
    const view = p && projects().view().find((x) => x.name === name);
    return runCheckup({ keyOk: await keyOk(), helperOk: helperOk(), ...spend(), project: p ? { ...p, ...view, path: p.path } : null, github });
  });
}
