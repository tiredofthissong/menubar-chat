// modes.mjs - the only two permission modes this app ever runs in.
// "Accept edits", "auto", "bypass" and "don't ask" are left out on purpose:
// Accept edits runs rm without asking, and the others approve without a card.
export const START_MODE = 'default';
export const MODES = { default: 'Ask me first', plan: 'Plan first' };
export const isAllowedMode = (m) => Object.hasOwn(MODES, m);
