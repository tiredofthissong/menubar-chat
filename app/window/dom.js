// dom.js - three small helpers the other window scripts share. Plain script (no imports).
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
  return { $, el, button };
})();
