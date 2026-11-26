// github-list.mjs - the list of your GitHub repos for Add from GitHub, private ones included.
// It uses the sign-in this Mac's git already has for github.com (the same one Add from GitHub's copy
// uses), asked for with `git credential fill`. Nothing new to set up. The sign-in stays in this file:
// it is never logged, saved, or sent to the window or to Claude, and goes only to api.github.com.
// The newest-changed repos come first, so one you just made in the Claude app is at the top.
import { spawn } from 'node:child_process';

const API = 'https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member';
const PAGES = 5; // up to 500 repos

/** Asks git for its github.com sign-in. Resolves to the token, or '' when git has none. Never prompts. */
export const gitToken = () => new Promise((resolve) => {
  let out = '';
  const git = spawn('git', ['credential', 'fill'], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' }, timeout: 15000 });
  git.stdout.on('data', (d) => { out += d; });
  git.on('error', () => resolve(''));
  git.on('close', (code) => resolve(code === 0 ? (out.match(/^password=(.+)$/m)?.[1] || '').trim() : ''));
  git.stdin.end('protocol=https\nhost=github.com\n\n');
});

const shape = (r) => ({ full: String(r.full_name), private: !!r.private, pushed: r.pushed_at || null });

/**
 * @returns {Promise<{ ok: true, repos: Array<{ full: string, private: boolean, pushed: string|null }> } | { ok: false, error: string }>}
 */
export async function listRepos({ token = gitToken, get = fetch } = {}) {
  const t = await token();
  if (!t) return { ok: false, error: "This Mac's git isn't signed in to GitHub yet, so your repos can't be listed. You can still type a repo below." };
  const repos = [];
  try {
    for (let page = 1; page <= PAGES; page++) {
      const r = await get(`${API}&page=${page}`, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json', 'User-Agent': 'menu-bar-chat' } });
      if (r.status === 401) return { ok: false, error: "GitHub didn't accept this Mac's sign-in, so the list can't load. You can still type a repo below." };
      if (!r.ok) return { ok: false, error: "GitHub didn't send the list just now. Try Refresh, or type the repo below." };
      const batch = await r.json();
      if (!Array.isArray(batch)) break;
      repos.push(...batch.map(shape));
      if (batch.length < 100) break;
    }
  } catch { return { ok: false, error: "Couldn't reach GitHub. Check your internet, then try Refresh." }; }
  return { ok: true, repos };
}
