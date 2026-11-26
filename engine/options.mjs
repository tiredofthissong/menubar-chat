// options.mjs - the ONLY place SDK query() options are built. Pure: no I/O.
//  - permissionMode is required and always written out (never left to settings files).
//  - Never sets allowDangerouslySkipPermissions or allowedTools (allow rules skip canUseTool).
//  - Hard rules three times: PreToolUse hook (onFailure 'block'), deny rules, canUseTool.
//  - env is an ALLOWLIST: the SDK gives the child exactly this object, so ANTHROPIC_API_KEY
//    or anything else in the app's own environment never reaches Claude Code.
//  - The API key comes from the macOS Keychain through apiKeyHelper, per session. It never
//    sits in this process, a file, or ~/.claude/settings.json.
// Adapted from this project's code-health architect prototype.
import { NEXT_RULE } from './next.mjs';
import { isAllowedMode, claudeCodeMode } from '../policy/modes.mjs';
import { denyRules } from '../policy/rules.mjs';

export const SAFE_ENV_KEYS = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'SSH_AUTH_SOCK'];
export const CLIENT_APP = 'menubar-chat/0.0.1';
export const KEYCHAIN_SERVICE = 'claude-menubar-anthropic';
// Bromo's pick (Nov 26): Sonnet, about half the cost of Opus. The alias follows the latest Sonnet.
export const DEFAULT_MODEL = 'sonnet';
export const WHY_RULE = 'Before each file edit, command, web lookup or other step that may need permission, write one short line that starts with "Why:" saying in plain words why you need it.';
// Bromo, Nov 26: Claude told him to edit plants.json "in a code editor" - the opposite of what this
// app is for. And his worry from the first build: Claude rushing to a demo before checking its work.
export const USER_RULE = 'The person uses this chat app instead of a terminal or code editor, and is new to coding. '
  + 'Never ask them to edit a file, run a command or open an editor themselves: offer to do it, and do it when they say yes (the app asks them before each change). '
  + 'When something truly must be theirs, make it a click in the app or a page in their browser, with exact steps. '
  + 'Before you call work done or suggest a demo, run the tests and checks this project has (or add a small one), say in one line what you checked and what is still untested, and fix what fails first.';

export function safeEnv(source = process.env) {
  const env = { CLAUDE_AGENT_SDK_CLIENT_APP: CLIENT_APP };
  for (const k of SAFE_ENV_KEYS) if (typeof source[k] === 'string') env[k] = source[k];
  return env;
}

const KEYCHAIN_NAME = /^[A-Za-z0-9._-]{3,64}$/;

/**
 * @param {object} a
 * @param {{ path: string, tag: string }} a.project
 * @param {string} a.mode                  REQUIRED. 'default' or 'plan'.
 * @param {Function} a.canUseTool
 * @param {Function} a.preToolUseHook
 * @param {string|null} a.keychainService  null only with a mock spawn
 * @param {string[]} [a.hubPaths]
 * @param {string|null} [a.resumeId]
 * @param {number|null} [a.budgetUsd]
 * @param {string} [a.model]             defaults to DEFAULT_MODEL
 * @param {Function|null} [a.spawn]        tests only: replaces the Claude Code binary
 */
export function buildQueryOptions(a) {
  if (!isAllowedMode(a.mode)) throw new Error(`refusing to start: permission mode "${a.mode}" is not allowed`);
  if (typeof a.canUseTool !== 'function' || typeof a.preToolUseHook !== 'function') throw new Error('refusing to start: approval callback and hook are both required');
  if (!a.spawn && !KEYCHAIN_NAME.test(a.keychainService ?? '')) throw new Error('refusing to start: no Keychain item named for the API key');

  const options = {
    cwd: a.project.path,
    model: a.model || DEFAULT_MODEL, // always written out, so Claude Code's own default (Opus) never applies
    permissionMode: claudeCodeMode(a.mode), // Dev mode is Ask me first to Claude Code; the app goes ahead in the folder
    canUseTool: a.canUseTool,
    hooks: { PreToolUse: [{ hooks: [a.preToolUseHook], onFailure: 'block' }] },
    disallowedTools: denyRules({ project: a.project, hubPaths: a.hubPaths || [] }),
    settingSources: ['user', 'project', 'local'], // same ~/.claude, CLAUDE.md and skills as the Terminal
    includePartialMessages: true,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: `${WHY_RULE} ${USER_RULE} ${NEXT_RULE}` },
    env: safeEnv(),
  };
  if (a.keychainService) options.settings = { apiKeyHelper: `/usr/bin/security find-generic-password -s ${a.keychainService} -w` };
  if (a.resumeId) options.resume = a.resumeId;
  if (typeof a.budgetUsd === 'number' && a.budgetUsd > 0) options.maxBudgetUsd = a.budgetUsd;
  if (a.spawn) options.spawnClaudeCodeProcess = a.spawn;
  return options;
}
