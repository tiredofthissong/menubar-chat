// options.mjs - the ONLY place SDK query() options are built. Pure: no I/O.
//  - permissionMode is required and always written out (never left to settings files).
//  - Never sets allowDangerouslySkipPermissions or allowedTools (allow rules skip canUseTool).
//  - Hard rules three times: PreToolUse hook (onFailure 'block'), deny rules, canUseTool.
//  - env is an ALLOWLIST: the SDK gives the child exactly this object, so ANTHROPIC_API_KEY
//    or anything else in the app's own environment never reaches Claude Code.
//  - The API key comes from the macOS Keychain through apiKeyHelper, per session. It never
//    sits in this process, a file, or ~/.claude/settings.json.
// Adapted from this project's code-health architect prototype.
import { isAllowedMode } from '../policy/modes.mjs';
import { denyRules } from '../policy/rules.mjs';

export const SAFE_ENV_KEYS = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'SSH_AUTH_SOCK'];
export const CLIENT_APP = 'menubar-chat/0.0.1';
export const KEYCHAIN_SERVICE = 'claude-menubar-anthropic';
export const WHY_RULE = 'Before each file edit, write one short line that starts with "Why:" saying why you are making it.';

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
 * @param {Function|null} [a.spawn]        tests only: replaces the Claude Code binary
 */
export function buildQueryOptions(a) {
  if (!isAllowedMode(a.mode)) throw new Error(`refusing to start: permission mode "${a.mode}" is not allowed`);
  if (typeof a.canUseTool !== 'function' || typeof a.preToolUseHook !== 'function') throw new Error('refusing to start: approval callback and hook are both required');
  if (!a.spawn && !KEYCHAIN_NAME.test(a.keychainService ?? '')) throw new Error('refusing to start: no Keychain item named for the API key');

  const options = {
    cwd: a.project.path,
    permissionMode: a.mode,
    canUseTool: a.canUseTool,
    hooks: { PreToolUse: [{ hooks: [a.preToolUseHook], onFailure: 'block' }] },
    disallowedTools: denyRules({ project: a.project, hubPaths: a.hubPaths || [] }),
    settingSources: ['user', 'project', 'local'], // same ~/.claude, CLAUDE.md and skills as the Terminal
    includePartialMessages: true,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: WHY_RULE },
    env: safeEnv(),
  };
  if (a.keychainService) options.settings = { apiKeyHelper: `/usr/bin/security find-generic-password -s ${a.keychainService} -w` };
  if (a.resumeId) options.resume = a.resumeId;
  if (typeof a.budgetUsd === 'number' && a.budgetUsd > 0) options.maxBudgetUsd = a.budgetUsd;
  if (a.spawn) options.spawnClaudeCodeProcess = a.spawn;
  return options;
}
