// block-pushes.mjs - add (or remove) a git pre-push hook that refuses EVERY push from a repo.
// For work repos: it closes the gap the app's own guard can't see (a push hidden inside a
// script or a git alias). The hook lives in .git/hooks, so it is never committed or shared.
//
//   npm run block-pushes -- <repo folder>            add the block
//   npm run block-pushes -- --remove <repo folder>   take it off again (only ours)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const MARKER = 'menubar-chat push block';
export const HOOK = `#!/bin/sh
# ${MARKER}: refuses every push from this repo.
# Remove with: npm run block-pushes -- --remove <this repo folder>
echo "Push blocked: this is a work repo, so nothing leaves your Mac. (${MARKER})" >&2
exit 1
`;

export function hookPath(repo) {
  const rel = execFileSync('git', ['rev-parse', '--git-path', 'hooks/pre-push'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return path.resolve(repo, rel);
}

/** @returns {{ ok: boolean, text: string }} */
export function blockPushes(repoArg, { remove = false } = {}) {
  const repo = path.resolve(repoArg || '');
  if (!repoArg || !fs.existsSync(repo)) return { ok: false, text: `No folder at ${repo}. Nothing changed.` };
  let hp;
  try { hp = hookPath(repo); } catch { return { ok: false, text: `${repo} isn't a git repo. Nothing changed.` }; }
  const existing = fs.existsSync(hp) ? fs.readFileSync(hp, 'utf8') : null;
  const ours = existing?.includes(MARKER);
  if (remove) {
    if (!existing) return { ok: true, text: `No push block in ${repo}. Nothing changed.` };
    if (!ours) return { ok: false, text: `${repo} has a different pre-push hook that isn't ours, so it was left alone.` };
    fs.rmSync(hp);
    return { ok: true, text: `Push block removed from ${repo}.` };
  }
  if (ours) return { ok: true, text: `${repo} already has the push block. Nothing changed.` };
  if (existing) return { ok: false, text: `${repo} already has its own pre-push hook, so it was left alone. Tell Claude and we'll combine them.` };
  fs.mkdirSync(path.dirname(hp), { recursive: true });
  fs.writeFileSync(hp, HOOK, { mode: 0o755 });
  return { ok: true, text: `Push block added to ${repo}. Every git push from it will now be refused.` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const remove = args.includes('--remove');
  const r = blockPushes(args.find((a) => !a.startsWith('--')), { remove });
  console.log(r.text);
  process.exitCode = r.ok ? 0 : 1;
}
