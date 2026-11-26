// scroll.js - how the conversation scrolls. Plain script, loaded before app.js; also loaded by
// test/scroll.test.mjs. Three jobs:
// 1. Follow new messages only while you're already at the bottom, so reading back isn't yanked away.
// 2. A backup for trackpads and wheels: if a wheel turn didn't move the conversation, move it by hand.
// 3. Keep the window from resizing over and over for the same size.
'use strict';
(function (root) {
  const SLACK = 40; // px from the bottom that still counts as "at the bottom"

  const isAtBottom = (el, slack = SLACK) => el.scrollHeight - el.scrollTop - el.clientHeight <= slack;

  const maxTop = (el) => Math.max(0, el.scrollHeight - el.clientHeight);

  // Wheel deltas come in pixels (trackpads), lines (some mice) or pages.
  function wheelPixels(ev, pageHeight) {
    if (ev.deltaMode === 1) return ev.deltaY * 16;
    if (ev.deltaMode === 2) return ev.deltaY * pageHeight;
    return ev.deltaY;
  }

  // Called a moment after a wheel event. If the browser already scrolled, do nothing.
  // Returns the new scrollTop it set, or null when it left things alone.
  function fallbackScroll(el, topBefore, pixels) {
    if (!pixels || el.scrollTop !== topBefore) return null;
    const next = Math.min(maxTop(el), Math.max(0, topBefore + pixels));
    if (next === topBefore) return null; // already at the top or bottom
    el.scrollTop = next;
    return next;
  }

  // Only ask for a new window height when it really changed.
  function makeSizeGate(threshold = 4) {
    let last = null;
    return (wanted) => {
      if (!Number.isFinite(wanted)) return false;
      if (last !== null && Math.abs(wanted - last) <= threshold) return false;
      last = wanted;
      return true;
    };
  }

  root.ChatScroll = { SLACK, isAtBottom, maxTop, wheelPixels, fallbackScroll, makeSizeGate };
})(typeof window !== 'undefined' ? window : globalThis);
