// put-away.mjs - checks that a project copied from GitHub has nothing that lives only on this Mac,
// so its folder can go to the Trash and be copied back later. Every check has to pass:
// no unsaved changes, no set-aside changes (stash), every branch on GitHub with nothing waiting
// to be pushed, and no git-ignored files except ones a tool can rebuild (like node_modules).
import { run, parseRepo } from './github.mjs';

const REBUILT = new Set(['node_modules', '.DS_Store', 'dist', 'build', '.next', '.cache', '__pycache__', '.venv', 'venv', '.pytest_cache', 'coverage', '.parcel-cache']);
const list = (items) => items.slice(0, 3).join(', ') + (items.length > 3 ? ` and ${items.length - 3} more` : '');

/** Null when the folder is safe to put away, or the reason it isn't, in plain words. */
export async function whyNotPutAway(folder, repo, git = run) {
  const origin = await git(['remote', 'get-url', 'origin'], folder);
  const ref = parseRepo(origin.out); const want = parseRepo(repo);
  if (!origin.ok || !ref || !want || `${ref.owner}/${ref.repo}`.toLowerCase() !== `${want.owner}/${want.repo}`.toLowerCase()) {
    return `This folder isn't linked to ${repo} on GitHub any more, so it stays on your Mac. Ask Claude in this project to link it again.`;
  }
  const status = await git(['status', '--porcelain', '--ignored=matching'], folder);
  if (!status.ok) return "Git couldn't read this folder, so it stays on your Mac. Ask Claude in this project to check it.";
  // Each line is a one- or two-letter code, then the file. The output comes trimmed, so the first
  // line can lose its leading space; reading the code this way works either way.
  const lines = (status.out ? status.out.split('\n') : []).map((l) => l.match(/^\s*(\S{1,2})\s+(.*)$/)).filter(Boolean);
  const changed = lines.filter(([, code]) => code !== '!!').map(([, , file]) => file);
  if (changed.length) return `These changes aren't on GitHub yet: ${list(changed)}. Ask Claude to save and push them first.`;
  const ignored = lines.filter(([, code]) => code === '!!').map(([, , file]) => file.replace(/\/$/, ''))
    .filter((f) => !f.split('/').some((part) => REBUILT.has(part)));
  if (ignored.length) return `These files are only on this Mac, because git is set to skip them: ${list(ignored)}. Move them somewhere safe first, or they'd go to the Trash with the folder.`;
  const stash = await git(['stash', 'list'], folder);
  if (stash.out) return 'This folder has changes set aside (a git stash) that are only on this Mac. Ask Claude to save them first.';
  const fetched = await git(['fetch', '--quiet', 'origin'], folder);
  if (!fetched.ok) return "Couldn't reach GitHub to check, so the folder stays on your Mac. Try again when you're online.";
  const refs = await git(['for-each-ref', '--format=%(refname:short)|%(upstream)|%(upstream:track)', 'refs/heads'], folder);
  if (!refs.ok) return "Git couldn't list this folder's branches, so it stays on your Mac. Ask Claude in this project to check it.";
  for (const line of refs.out ? refs.out.split('\n') : []) {
    const [branch, upstream, track] = line.split('|');
    if (!upstream || /gone/.test(track)) return `The branch ${branch} is only on this Mac. Ask Claude to push it first.`;
    if (/ahead/.test(track)) return `The branch ${branch} has snapshots that aren't on GitHub yet. Ask Claude to push them first.`;
  }
  return null;
}
