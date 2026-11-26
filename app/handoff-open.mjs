// handoff-open.mjs - opens Claude Code in Claude's desktop app for a big job (engine/handoff.mjs).
// Only links of the exact shape the app makes are opened; anything else is ignored.
import { isHandoffLink } from '../engine/handoff.mjs';

export function createHandoffOpener({ shell, send }) {
  return function onEvent(ev) {
    if (ev?.type !== 'handoff' || ev.auto !== true || !isHandoffLink(ev.url)) return;
    shell.openExternal(ev.url).catch(() => send({ type: 'hint', project: ev.project, kind: 'handoff',
      text: 'Claude\'s desktop app didn\'t open, so the big job wasn\'t handed over. If it isn\'t installed, install it and ask again, or say "do it here".' }));
  };
}
