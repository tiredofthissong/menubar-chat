// init-check.mjs - refuse to run unless the first frame proves the session is safe.
// 1. Billing: the key must come from our apiKeyHelper (the Keychain). Without it, Claude Code
//    quietly falls back to your subscription login (code.claude.com/docs/en/authentication).
// 2. Mode: the session must report exactly the mode we asked for. Settings files can change it.
export const OK_KEY_SOURCES = ['apiKeyHelper'];

/** @returns {{ ok: true } | { ok: false, code: string, text: string }} */
export function checkInit(init, askedMode) {
  if (!OK_KEY_SOURCES.includes(init?.apiKeySource)) {
    return { ok: false, code: 'wrong-credential', text: `Stopped: Claude Code is using "${init?.apiKeySource ?? 'unknown'}" instead of your app API key, so nothing more was sent.` };
  }
  if (init?.permissionMode !== askedMode) {
    return { ok: false, code: 'wrong-mode', text: `Stopped: Claude Code started in "${init?.permissionMode ?? 'unknown'}" instead of "${askedMode}". A settings file may have changed it.` };
  }
  return { ok: true };
}
