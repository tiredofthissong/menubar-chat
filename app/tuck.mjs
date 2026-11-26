// tuck.mjs - when the window tucks itself away after a reply (DESIGN.md, milestone 3).
// Esc, a second click on the icon, clicking another app and the hotkey always tuck it away at once.
// After a reply it tucks away by itself about 5 seconds later, but never while you type, while a
// card waits on you or while Claude is still working. While the pointer is over the window it
// waits, and counts again from the start once the pointer leaves.
export const TUCK_AFTER_MS = 5000;

/**
 * Why the window stays open, or null when it may tuck away.
 * @param {{ visible: boolean, hovered: boolean, typing: boolean, pendingCards: number, busy: number }} s
 * @returns {null | 'hidden' | 'card' | 'typing' | 'working' | 'pointer'}
 */
export function holdReason(s) {
  if (!s.visible) return 'hidden';
  if (s.pendingCards > 0) return 'card';
  if (s.typing) return 'typing';
  if (s.busy > 0) return 'working';
  if (s.hovered) return 'pointer';
  return null;
}

export class TuckTimer {
  /** @param {{ hide: () => void, state: () => object, after?: number, setTimer?: Function, clearTimer?: Function }} d */
  constructor({ hide, state, after = TUCK_AFTER_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { hide, state, after, setTimer, clearTimer });
    this.armed = false; this.timer = null;
  }

  /** A reply finished: start counting. */
  replied() { this.armed = true; this.restart(); }

  /** The pointer, the chat box or the cards changed. */
  changed() {
    if (!this.armed) return;
    const why = holdReason(this.state());
    if (why === null) { if (!this.timer) this.restart(); return; }
    if (why === 'pointer') { this.clear(); return; } // keep waiting; counts again once it leaves
    this.cancel(); // you're typing, a card waits or Claude went back to work: the next reply counts again
  }

  /** The window just opened or just tucked away: an old reply never tucks a fresh window. */
  cancel() { this.armed = false; this.clear(); }

  restart() { this.clear(); this.timer = this.setTimer(() => this.fire(), this.after); }
  clear() { if (this.timer) { this.clearTimer(this.timer); this.timer = null; } }

  fire() {
    this.timer = null;
    if (!this.armed) return;
    const why = holdReason(this.state());
    if (why === null) { this.armed = false; this.hide(); return; }
    if (why !== 'pointer') this.armed = false;
  }
}
