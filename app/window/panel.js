// panel.js - the two drop-down panels under the top bar. Plain script.
//   Projects: switch project, add a folder (Work or Personal), start a new chat, pick up a past
//             chat, change the tag, and add the push block to a work repo.
//   Usage:    today against the daily cap, this chat in dollars, how much of Claude's memory
//             this chat has used, and the learning log by Claude Academy course.
//   Wrap up:  adds one dated note about this chat to HANDOFF.md in the project folder.
// Anything that changes a setting or a repo asks first, in the panel, with two answers that look
// the same and neither picked.
'use strict';
window.ChatPanel = (() => {
  const { $, el, button } = window.ChatDom;
  let ctx = null; let open = null;
  const PANELS = { projects: ['panel-projects', 'project'], usage: ['panel-usage', 'spend'] };

  const when = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
  const say = (r) => { if (r && r.ok === false && !r.canceled) ctx.notice(r.error || r.text, true); else if (r?.text) ctx.notice(r.text); return r; };

  function section(title) { const s = el('div', 'panel-section'); s.append(el('h2', 'panel-title', title)); return s; }
  /** A question asked in place: two answers that look the same, neither picked. */
  function confirm(where, question, no, yes, onYes, onNo = () => {}) {
    where.querySelector('.confirm')?.remove();
    const row = el('div', 'confirm'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', question);
    const actions = el('div', 'confirm-actions');
    actions.append(button(no, 'btn btn-small', () => { row.remove(); onNo(); }), button(yes, 'btn btn-small', () => { row.remove(); onYes(); }));
    row.append(el('p', '', question), actions);
    where.append(row);
  }

  function projectList() {
    const s = section('Projects'); const list = el('div', 'project-list');
    for (const p of ctx.projects()) {
      const b = button(p.name, 'project-item', () => { ctx.select(p.name); close(); });
      b.append(el('span', 'pill', p.tag));
      if (p.name === ctx.current()) b.setAttribute('aria-current', 'true');
      list.append(b);
    }
    const add = button('Add a folder…', 'btn btn-small btn-quiet', async () => {
      const r = say(await ctx.api.pickFolder());
      if (!r?.ok) return;
      confirm(s, `Is "${r.folder}" work or personal? Work never pushes to GitHub or touches your personal hub.`, 'Work', 'Personal',
        () => saveFolder('personal'), () => saveFolder('work'));
    });
    s.append(list, add);
    return s;
  }
  async function saveFolder(tag) {
    const r = say(await ctx.api.addFolder(tag));
    if (r?.ok) { ctx.setProjects(r.projects); ctx.select(r.added); render(); }
  }

  function chats(name) {
    const s = section(`Chats in ${name}`);
    const row = el('div', 'confirm-actions');
    row.append(button('New chat', 'btn btn-small btn-quiet', () => { ctx.api.newChat(name).then(say); close(); }),
      button('Wrap up this chat', 'btn btn-small btn-quiet', () => confirm(s, 'Add a dated note about this chat to the end of HANDOFF.md in this folder? Nothing else changes.',
        'Cancel', 'Add the note', async () => say(await ctx.api.wrapUp(name)))));
    s.append(row);
    const list = el('div', 'chat-list'); list.append(el('p', 'muted', 'Loading past chats…'));
    s.append(list);
    ctx.api.history(name).then((r) => {
      list.replaceChildren();
      const past = r?.ok ? r.sessions : [];
      if (!past.length) { list.append(el('p', 'muted', 'No past chats yet.')); return; }
      for (const c of past) {
        const b = button(c.title, 'chat-item', () => { ctx.api.resume(name, c.sessionId).then(say); close(); });
        b.append(el('span', 'muted', when(c.lastModified)));
        list.append(b);
      }
    });
    return s;
  }

  function safety(p) {
    const s = section('Safety');
    if (p.tag === 'personal') {
      s.append(el('p', '', 'Personal: a GitHub push asks you first on a card.'),
        button('Make it work', 'btn btn-small btn-quiet', () => tag(p.name, 'work')));
      return s;
    }
    s.append(el('p', '', 'Work: GitHub pushes and your personal hub are blocked, with no button to override.'),
      button('Make it personal', 'btn btn-small btn-quiet', () => confirm(s, `Make "${p.name}" personal? Claude could then push to GitHub after you allow each push.`,
        'Keep it work', 'Make it personal', () => tag(p.name, 'personal'))));
    const block = {
      on: 'Push block is on: git refuses every push from this folder, even one hidden in a script or alias.',
      off: 'Push block is off. It also stops a push hidden in a script or alias.',
      other: 'This repo has its own pre-push hook, so the push block was left off. Ask Claude to combine them.',
      'not-git': 'Not a git repo, so there is nothing to push.',
    }[p.pushBlock] || '';
    if (block) s.append(el('p', 'panel-note', block));
    if (p.pushBlock === 'off') {
      s.append(button('Add push block', 'btn btn-small btn-quiet', () => confirm(s, 'Add the push block? It puts a small file in this repo\'s .git/hooks folder that makes git refuse every push. It is never committed.',
        'Cancel', 'Add push block', async () => { const r = say(await ctx.api.blockPushes(p.name)); if (r?.projects) { ctx.setProjects(r.projects); render(); } })));
    }
    return s;
  }
  async function tag(name, t) { const r = say(await ctx.api.setTag(name, t)); if (r?.ok) { ctx.setProjects(r.projects); ctx.select(name); render(); } }

  function usage() {
    const u = ctx.usage(); const s = section('Usage');
    const today = el('progress'); today.max = u.cap; today.value = Math.min(u.spent, u.cap); today.setAttribute('aria-label', 'Spent today');
    s.append(el('p', '', `Today: $${u.spent.toFixed(2)} of $${u.cap}`), today, el('p', '', `This chat: $${(u.chatUsd ?? 0).toFixed(2)}`));
    if (u.contextPct == null) s.append(el('p', 'muted', 'Memory used: shows after the first reply.'));
    else { const m = el('progress'); m.max = 100; m.value = u.contextPct; m.setAttribute('aria-label', 'Memory used'); s.append(el('p', '', `Memory used: ${u.contextPct}%`), m); }
    s.append(el('p', 'panel-note', `Model: ${u.model}. Costs update when each reply finishes. They are Claude Code\'s own estimate at list prices; your Anthropic Console shows the exact bill. Spending stops at the daily cap and starts over at midnight. A long chat uses more memory; a new chat starts fresh.`), el('p', 'panel-note', 'Right-click the menu bar icon to quit, or to start the app when your Mac starts.'));
    return s;
  }

  // What you've met on cards, by Claude Academy course, with the course one click away.
  function learning() {
    const s = section('Learning'); const list = el('div', 'chat-list'); list.append(el('p', 'muted', 'Loading…'));
    s.append(list);
    ctx.api.learnSummary().then((r) => {
      list.replaceChildren();
      const met = (r?.ok ? r.courses : []).filter((c) => c.count > 0);
      if (!met.length) { list.append(el('p', 'panel-note', 'Each card you see adds a line here, tagged with its Claude Academy course.')); return; }
      for (const c of met) {
        const b = button(c.course, 'chat-item', () => ctx.api.openLearn(c.url).then(say));
        b.title = `Open ${c.course} on Claude Academy`;
        b.append(el('span', 'muted', `${c.count} ${c.count === 1 ? 'card' : 'cards'}`));
        list.append(b);
      }
    });
    return s;
  }

  function render() {
    if (open === 'projects') {
      const p = ctx.projects().find((x) => x.name === ctx.current());
      $('panel-projects').replaceChildren(projectList(), ...(p ? [chats(p.name), safety(p)] : []));
    }
    if (open === 'usage') $('panel-usage').replaceChildren(usage(), learning());
  }
  function toggle(which) {
    const was = open; close(false);
    if (was === which) return;
    open = which; const [panel, btn] = PANELS[which];
    $(panel).hidden = false; $(btn).setAttribute('aria-expanded', 'true');
    render();
  }
  /** @returns {boolean} whether a panel was open */
  function close(refocus = true) {
    if (!open) return false;
    const [panel, btn] = PANELS[open]; open = null;
    $(panel).hidden = true; $(panel).replaceChildren(); $(btn).setAttribute('aria-expanded', 'false');
    if (refocus) $(btn).focus();
    return true;
  }

  function init(c) {
    ctx = c;
    $('project').addEventListener('click', () => toggle('projects'));
    $('spend').addEventListener('click', () => toggle('usage'));
  }
  return { init, close, refresh: () => render() };
})();
