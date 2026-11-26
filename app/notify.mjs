// notify.mjs - the Mac notification for a card that waits on you while the window is tucked away.
// It offers Review and Deny only: Allow needs the card itself, where you can see every step.
import { redact } from '../shared/redact.mjs';

export const ACTIONS = ['Review', 'Deny'];

/** @param {{ project: string, card: { plain?: string } }} ev  @returns {object} Electron Notification options */
export function approvalNotice(ev) {
  return {
    title: redact(`Waiting on you · ${ev.project}`).slice(0, 80),
    body: redact(ev.card?.plain || 'Claude wants to do something.').slice(0, 180),
    actions: ACTIONS.map((text) => ({ type: 'button', text })),
  };
}
