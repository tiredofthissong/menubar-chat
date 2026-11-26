// log.js - the conversation: one log per project, Claude's replies drawn as Markdown, change
// cards with Undo, and scrolling that follows new messages only while you're at the bottom.
// Plain script. Text goes in with textContent; markdown.js builds elements, never HTML.
'use strict';
window.ChatLog = (() => {
  const { $, el, button } = window.ChatDom;
  const S = window.ChatScroll; const MD = window.ChatMarkdown;
  const EMPTY = 'Ask Claude to do something in this project, in your own words. Anything that changes a file or runs a command asks you first. Pasted Terminal lines work too.';

  const logs = new Map(); const bubble = new Map(); const sources = new WeakMap(); const undos = new Map();
  let current = null; let stick = true;
  const jump = button('Jump to latest', 'jump btn btn-small'); jump.hidden = true;

  function logFor(project) {
    if (!logs.has(project)) { const box = el('div', 'project-log'); box.append(el('p', 'empty', EMPTY)); logs.set(project, box); }
    return logs.get(project);
  }
  function toBottom() { const log = $('log'); log.scrollTop = log.scrollHeight; stick = true; jump.hidden = true; }
  function follow() { if (stick) toBottom(); else jump.hidden = false; }
  function show(project) { current = project; $('log').replaceChildren(logFor(project), jump); toBottom(); }
  function add(project, node) {
    const box = logFor(project); box.querySelector('.empty')?.remove();
    box.append(node);
    if (project === current) follow();
  }

  // Claude's reply arrives a line or so at a time: keep the raw text and redraw the bubble.
  function text(project, t) {
    let b = bubble.get(project);
    if (!b) { b = el('div', 'msg msg-claude md'); sources.set(b, ''); bubble.set(project, b); add(project, b); }
    sources.set(b, sources.get(b) + t);
    b.replaceChildren(MD.render(sources.get(b), document));
    if (project === current) follow();
  }
  const endReply = (project) => bubble.delete(project);
  function line(project, t, cls = '', extra = null) {
    endReply(project);
    const n = el('div', `line ${cls}`.trim()); n.append(el('span', '', t));
    if (extra) n.append(extra);
    add(project, n);
  }
  function you(project, t) {
    endReply(project); stick = true;
    for (const b of logFor(project).querySelectorAll('.next button')) b.disabled = true; // old suggestions are done
    add(project, el('div', 'msg msg-you', t));
  }

  // A fresh start for this project's log: a new chat, or a past chat picked up from the panel.
  function reset(project) {
    endReply(project);
    logFor(project).replaceChildren();
    if (project === current) toBottom();
  }
  // A past chat's turns, drawn the same way as live ones (Claude's as Markdown).
  function past(project, turns) {
    for (const t of turns) {
      if (t.who === 'you') add(project, el('div', 'msg msg-you', t.text));
      else { const b = el('div', 'msg msg-claude md'); b.append(MD.render(t.text, document)); add(project, b); }
    }
  }

  // Claude's suggested next steps, one button each. A button sends that line as your message, so
  // anything it leads to still asks you first on a card.
  function next(project, items, pick) {
    endReply(project);
    const row = el('div', 'next'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Suggested next steps');
    for (const item of items) row.append(button(item, 'btn btn-small btn-quiet', () => pick(item)));
    add(project, row);
  }

  // What changed and why, the change itself one click away, and Undo.
  function diffOf(hunks) {
    const pre = el('pre', 'diff');
    for (const h of hunks || []) {
      for (const l of h.lines || []) {
        const kind = l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : 'same';
        pre.append(el('span', `diff-${kind}`, `${l}\n`));
      }
    }
    return pre;
  }
  function change(project, ch, onUndo) {
    endReply(project);
    const card = el('div', 'change');
    const head = el('div', 'change-head'); head.append(el('span', 'change-say', ch.sentence));
    if (ch.canUndo) { const b = button('Undo', 'btn btn-small btn-quiet', () => onUndo(ch.id)); undos.set(ch.id, b); head.append(b); }
    card.append(head);
    if (Array.isArray(ch.diff) && ch.diff.length) {
      const d = el('details', 'change-diff'); d.append(el('summary', '', 'Show the change'), diffOf(ch.diff));
      card.append(d);
    }
    add(project, card);
  }
  function undone(id) { const b = undos.get(id); if (b) { b.disabled = true; b.textContent = 'Undone'; } }

  // Window size: ask for the height the conversation and cards need, so the chat box never gets cut off.
  let api = null; let queued = false; const sizeChanged = S.makeSizeGate();
  function fit() {
    if (queued || !api) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const log = $('log'); const cards = $('cards'); const notice = $('notice');
      const logContent = (log.firstElementChild?.offsetHeight || 0) + 24; // content plus the log's own padding
      const cardsContent = cards.childElementCount ? cards.scrollHeight : 0;
      const noticeHeight = notice.hidden ? 0 : notice.offsetHeight + 12;
      const panels = [...document.querySelectorAll('.panel:not([hidden])')].reduce((h, p) => h + p.offsetHeight, 0);
      const wanted = Math.ceil(document.querySelector('.bar').offsetHeight + noticeHeight + panels + logContent + cardsContent + $('composer').offsetHeight);
      if (sizeChanged(wanted)) api.fit(wanted);
    });
  }

  function init(bridge) {
    api = bridge;
    const log = $('log');
    new ResizeObserver(() => { if (stick) toBottom(); }).observe(log);
    // Reading back: a scroll away from the bottom stops the follow; a wheel turn that didn't move
    // the conversation is applied by hand (backup for trackpads and mice).
    log.addEventListener('scroll', () => { stick = S.isAtBottom(log); jump.hidden = stick; }, { passive: true });
    log.addEventListener('wheel', (ev) => {
      const before = log.scrollTop; const px = S.wheelPixels(ev, log.clientHeight);
      requestAnimationFrame(() => requestAnimationFrame(() => S.fallbackScroll(log, before, px)));
    }, { passive: true });
    jump.addEventListener('click', toBottom);
    new ResizeObserver(fit).observe($('cards'));
    new ResizeObserver(fit).observe($('notice'));
    for (const p of document.querySelectorAll('.panel')) new ResizeObserver(fit).observe(p);
    new MutationObserver(fit).observe(log, { childList: true, subtree: true, characterData: true });
  }

  return { init, show, text, endReply, line, you, next, change, undone, fit, reset, past };
})();
