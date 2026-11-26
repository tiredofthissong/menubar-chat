// github.mjs - add a project straight from GitHub. You type the repo as owner/name or paste its
// GitHub link; the app checks that, then copies the repo (git clone) into ~/GitHub/<name> and
// adds that folder to the project list as Personal, because work data never goes to GitHub.
// The folder's path is built here from the checked name, never taken from the window.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const PART = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/; // GitHub owner names
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/** { owner, repo } from "owner/repo" or a github.com link, or null when it isn't one of those. */
export function parseRepo(text) {
  let s = String(text ?? '').trim();
  const link = s.match(/^(?:https:\/\/)?(?:www\.)?github\.com\/([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?\/?$/i);
  if (link) s = `${link[1]}/${link[2]}`;
  const m = s.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!m) return null;
  const [, owner, repo] = m;
  if (!PART.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

export const folderFor = (home, { repo }) => path.join(home, 'GitHub', repo);
const url = ({ owner, repo }) => `https://github.com/${owner}/${repo}.git`;

/** Plain words for git's clone errors. */
export function cloneError(text) {
  const t = String(text || '');
  if (/could not read Username|Authentication failed|terminal prompts disabled/i.test(t)) return 'GitHub asked for a sign-in, so nothing was copied. Ask Claude in any project to help you sign this Mac in to GitHub, then try again.';
  if (/not found|does not exist/i.test(t)) return "GitHub couldn't find that repo. Check the spelling, and that your account can see it.";
  if (/Could not resolve host|unable to access/i.test(t)) return "Couldn't reach GitHub. Check your internet and try again.";
  return "The copy from GitHub didn't work, so nothing was added.";
}

const run = (args, cwd) => new Promise((resolve) => {
  execFile('git', args, { cwd, timeout: 180000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout).trim(), err: String(stderr || err?.message || '') }));
});

/**
 * Copies the repo to ~/GitHub/<name>, or reuses that folder when it already holds the same repo.
 * @returns {Promise<{ ok: true, folder: string, reused: boolean } | { ok: false, error: string }>}
 */
export async function cloneRepo(ref, home, git = run) {
  const dest = folderFor(home, ref);
  if (fs.existsSync(dest)) {
    const r = await git(['remote', 'get-url', 'origin'], dest);
    const same = r.ok && parseRepo(r.out)?.owner.toLowerCase() === ref.owner.toLowerCase() && parseRepo(r.out)?.repo.toLowerCase() === ref.repo.toLowerCase();
    return same ? { ok: true, folder: dest, reused: true } : { ok: false, error: `~/GitHub/${ref.repo} already holds something else, so nothing was copied.` };
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const r = await git(['clone', '--quiet', url(ref), dest], path.dirname(dest));
  if (!r.ok) { fs.rmSync(dest, { recursive: true, force: true }); return { ok: false, error: cloneError(r.err) }; }
  return { ok: true, folder: dest, reused: false };
}
