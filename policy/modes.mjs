// modes.mjs - the only permission modes this app ever runs in.
// "Accept edits", "auto", "bypass" and "don't ask" are left out on purpose:
// Accept edits runs rm without asking, and the others approve without a card.
// Dev mode (Bromo, Nov 26) is this app's own: Claude Code runs in its normal asking mode, and the
// app goes ahead on steps that stay inside the project folder (policy/devmode.mjs). Anything
// else still gets a card.
export const START_MODE = 'default';
export const MODES = { default: 'Ask me first', plan: 'Plan first', dev: 'Dev mode' };
export const isAllowedMode = (m) => typeof m === 'string' && Object.hasOwn(MODES, m);

/** The mode Claude Code itself runs in. Dev mode is Ask me first to Claude Code. */
export const claudeCodeMode = (m) => (m === 'dev' ? 'default' : m);

/** @returns {{ ok: true, mode: string, label: string } | { ok: false, text: string }} */
export function requestMode(wanted) {
  if (!isAllowedMode(wanted)) return { ok: false, text: 'This app has three modes: Ask me first, Plan first and Dev mode.' };
  return { ok: true, mode: wanted, label: MODES[wanted] };
}
