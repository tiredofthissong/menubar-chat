// cards.js - the approval card, the most important screen in the app. Plain script.
// Rules (DESIGN.md): one plain line first; a chain names every step, numbered; the exact command
// is one click away; Deny and Allow look the same and neither is pre-selected (a stray Enter
// can't approve); a delete is a red card that offers Move to Trash instead.
'use strict';
window.ChatCards = (() => {
  const { el, button } = window.ChatDom;

  function steps(card) {
    const items = Array.isArray(card.items) && card.items.length > 1 ? card.items : null;
    if (!items) return null;
    const ol = el('ol', 'card-steps');
    for (const it of items) {
      const li = el('li', it.danger ? 'danger' : '');
      li.append(el('span', 'step-say', it.say)); // a delete step's words say DELETE, so it isn't color alone
      if (it.target) li.append(el('span', 'step-target', it.target));
      ol.append(li);
    }
    return { ol, count: items.length };
  }

  function exact(card, copy) {
    if (!card.command) return null;
    const d = el('details', 'card-exact');
    const body = el('div', 'exact-body');
    body.append(el('code', '', card.command), button('Copy', 'btn btn-small btn-quiet', () => copy(card.command)));
    d.append(el('summary', '', 'Show the exact command'), body);
    return d;
  }

  // One plain line about what this kind of step is, and where to learn more (checked links only).
  function learn(card, open) {
    const l = card.learn;
    if (!l || typeof l.line !== 'string' || typeof open !== 'function') return null;
    const box = el('div', 'card-learn'); box.append(el('span', 'card-learn-line', l.line));
    const more = button('Learn more', 'btn btn-small btn-quiet', () => open(l.academy));
    more.title = `${l.course} on Claude Academy`;
    const docs = button('Docs', 'btn btn-small btn-quiet', () => open(l.docs));
    docs.title = 'The Claude Code docs page on this';
    box.append(more, docs);
    return box;
  }

  /**
   * @param {string} project
   * @param {object} card   from the helper: { id, toolName, plain, items?, command?, danger, trash }
   * @param {{ answer: (decision: string) => void, copy: (text: string) => void, learn?: (url: string) => void }} act
   */
  function render(project, card, act) {
    const danger = card.danger === true;
    const c = el('article', danger ? 'card danger' : 'card');
    c.setAttribute('aria-label', `Claude is asking you, in ${project}`);
    c.append(el('div', 'card-kicker', `Claude is asking · ${project}`));
    const list = steps(card);
    // One plain line first. A chained command lists every step below it, so the line only counts them.
    c.append(el('p', 'card-ask', list ? `Run ${list.count} steps, in this order:` : (card.plain || `Use ${card.toolName}.`)));
    if (list) c.append(list.ol);
    if (danger) c.append(el('p', 'card-warn', 'This deletes files. Deleted files may not come back. Move to Trash keeps them in your Mac\'s Trash.'));
    const ex = exact(card, act.copy); if (ex) c.append(ex);
    const lm = learn(card, act.learn); if (lm) c.append(lm);
    const row = el('div', 'card-actions');
    // Same class for every answer, and no autofocus: nothing is pre-selected.
    row.append(button('Deny', 'btn', () => act.answer('deny')));
    if (card.trash === true) row.append(button('Move to Trash instead', 'btn', () => act.answer('trash')));
    row.append(button(danger ? 'Delete for good' : 'Allow once', 'btn', () => act.answer('allow')));
    c.append(row);
    return c;
  }

  /** While an answer is on its way, no second click can count. */
  const settle = (node) => { for (const b of node.querySelectorAll('.card-actions button')) b.disabled = true; };

  return { render, settle };
})();
