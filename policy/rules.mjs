// rules.mjs - the hard rules. Pure: no I/O, no SDK.
//
// checkToolCall() never returns "allow". It returns:
//   { decision: 'deny', rule, plain }  hard block; no button can override it
//   { decision: 'ask' }                go on to the normal Allow / Deny card
// It runs in the PreToolUse hook (which runs even for calls an allow rule in
// ~/.claude/settings.json would approve) and again in canUseTool. denyRules() is a
// third, declarative layer passed to the SDK.
// Adapted from this project's code-health architect prototype (research, Nov 25 2026).
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const expandHome = (p) => (p.startsWith('~/') ? path.join(HOME, p.slice(2)) : p);

// Strict projects: work, and untagged until a tag is picked.
export const isStrict = (project) => !project || project.tag !== 'personal';

// --- secret files: blocked in every project ----------------------------------------
const SECRET_DIRS = ['~/.ssh', '~/.aws', '~/.gnupg', '~/Library/Keychains', '~/.config/gh'].map(expandHome);
const isEnvFile = (name) => /^\.env(\..+)?$/.test(name) && !/\.(example|sample|template)$/.test(name);
const ENV_IN_SHELL = /(^|[\s'"/=<>])\.env(\.[\w-]+)?(?=$|[\s'";|&>])/;

function isSecretPath(p, cwd) {
  if (!p) return false;
  const abs = path.resolve(cwd || '/', expandHome(String(p)));
  return isEnvFile(path.basename(abs)) || SECRET_DIRS.some((d) => abs === d || abs.startsWith(d + path.sep));
}

// --- strict projects: never publish to GitHub, never touch the personal hub ----------
const PUBLISH_COMMANDS = [
  { re: /(^|[\s;&|(])gh\s/, what: 'the GitHub CLI (gh)' },
  { re: /\bgit\b[^;&|\n]*\bremote\s+(add|set-url)\b/, what: 'pointing this folder at a new remote' },
];
const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);
const NESTED_SHELL = /\b(sh|bash|zsh)\s+-c\b|\beval\b|\bxargs\b/;

/** Shell-ish words with quotes removed. A display-grade splitter, not a full shell parser. */
const words = (seg) => (seg.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((w) => w.replace(/^["']|["']$/g, ''));

/** True if any step of the command runs `git ... push` (git -C dir push, quoted, env prefix). */
export function runsGitPush(command) {
  return command.split(/&&|\|\||;|\||\n/).some((seg) => {
    if (NESTED_SHELL.test(seg) && /\bpush\b/.test(seg)) return true; // fail closed on sh -c "git push"
    const w = words(seg.trim());
    const gi = w.findIndex((x) => x === 'git' || x.endsWith('/git'));
    if (gi < 0) return false;
    for (let i = gi + 1; i < w.length; i++) {
      if (GIT_OPTS_WITH_VALUE.has(w[i])) { i++; continue; }
      if (w[i].startsWith('-')) continue;
      return w[i] === 'push'; // the first non-option word is the subcommand
    }
    return false;
  });
}
const STRICT_MCP = [
  { re: /^mcp__github__/, what: 'the GitHub connector' },
  { re: /^mcp__hub-mcp__/, what: 'the personal hub connector' },
];
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

const deny = (rule, plain) => ({ decision: 'deny', rule, plain });
const filePathOf = (input) => input?.file_path ?? input?.notebook_path ?? input?.path ?? '';
const underAny = (abs, roots) => roots.some((r) => abs === r || abs.startsWith(r + path.sep));

/**
 * @param {{ project: {tag: string, path: string}, hubPaths?: string[] }} ctx
 * @param {string} toolName  SDK tool name, e.g. "Bash", "Edit", "mcp__github__push_files"
 * @param {object} input     the tool input exactly as the SDK passes it
 */
export function checkToolCall({ project, hubPaths = [] }, toolName, input = {}) {
  const cwd = project?.path || '/';
  const command = toolName === 'Bash' ? String(input.command ?? '') : '';
  const file = filePathOf(input);

  if (isSecretPath(file, cwd) || ENV_IN_SHELL.test(command)) {
    return deny('secret-file', 'That file holds secrets (keys or passwords), so Claude may not open it. Nothing was read.');
  }
  if (!isStrict(project)) return { decision: 'ask' };

  const label = project?.tag === 'work' ? 'Work project' : 'Untagged project (treated as work until you tag it)';
  for (const m of STRICT_MCP) {
    if (m.re.test(toolName)) return deny('work-connector', `${label}: ${m.what} is switched off here. Nothing was sent.`);
  }
  if (runsGitPush(command)) return deny('work-publish', `${label}: git push is switched off here. Your changes stay on your Mac.`);
  for (const c of PUBLISH_COMMANDS) {
    if (c.re.test(command)) return deny('work-publish', `${label}: ${c.what} is switched off here. Your changes stay on your Mac.`);
  }
  const hubs = hubPaths.map(expandHome).map((h) => path.resolve(h));
  const touchesHub = (EDIT_TOOLS.has(toolName) && file && underAny(path.resolve(cwd, expandHome(file)), hubs))
    || (command && hubs.some((h) => command.includes(h) || command.includes(h.replace(HOME, '~'))));
  if (touchesHub) return deny('work-to-hub', `${label}: work files can't be written into the personal hub.`);
  return { decision: 'ask' };
}

/** Declarative SDK deny rules (permission rule syntax: code.claude.com/docs/en/permissions). */
export function denyRules({ project, hubPaths = [] }) {
  const rules = ['Read(./.env)', 'Read(./.env.*)', 'Read(~/.ssh/**)', 'Read(~/.aws/**)', 'Read(~/.gnupg/**)'];
  if (isStrict(project)) {
    rules.push('Bash(git push *)', 'Bash(gh *)', 'mcp__github__*', 'mcp__hub-mcp__*');
    for (const h of hubPaths) rules.push(`Edit(//${path.resolve(expandHome(h)).replace(/^\/+/, '')}/**)`);
  }
  return rules;
}
