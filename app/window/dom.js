// dom.js - four small helpers the other window scripts share. Plain script (no imports).
// Text always goes in with textContent, never innerHTML.
'use strict';
window.ChatDom = (() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  /** A real <button type="button"> with a click handler. */
  const button = (label, cls, onClick) => {
    const b = el('button', cls, label); b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  };
  /** A small copy button with the usual two-squares icon (Bromo, Nov 26: copy from cards and replies). */
  const copyButton = (getText, copy) => {
    const b = button('', 'btn btn-icon copy-btn', () => copy?.(getText()));
    b.setAttribute('aria-label', 'Copy'); b.title = 'Copy';
    const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); svg.setAttribute('aria-hidden', 'true');
    for (const [x, y] of [[5, 5], [2, 2]]) {
      const r = document.createElementNS(NS, 'rect');
      for (const [k, v] of Object.entries({ x, y, width: 9, height: 9, rx: 1.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 })) r.setAttribute(k, String(v));
      svg.append(r);
    }
    b.append(svg); return b;
  };
  return { $, el, button, copyButton };
})();
