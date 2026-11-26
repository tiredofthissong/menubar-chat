// modes.mjs - the only two permission modes this app ever runs in.
// "Accept edits", "auto", "bypass" and "don't ask" are left out on purpose:
// Accept edits runs rm without asking, and the others approve without a card.
export const START_MODE = 'default';
export const MODES = { default: 'Ask me first', plan: 'Plan first' };
export const isAllowedMode = (m) => typeof m === 'string' && Object.hasOwn(MODES, m);

/** @returns {{ ok: true, mode: string, label: string } | { ok: false, text: string }} */
export function requestMode(wanted) {
  if (!isAllowedMode(wanted)) return { ok: false, text: 'This app only has two modes: Ask me first and Plan first.' };
  return { ok: true, mode: wanted, label: MODES[wanted] };
}
