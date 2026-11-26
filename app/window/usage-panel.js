// usage-panel.js - the Usage panel, opened from today's spend in the top bar. Plain script.
// Today against the daily cap (the one big figure), this chat in dollars, how much of Claude's
// memory this chat has used, the fine print folded away, the learning log by Claude Academy
// course, and how to quit.
'use strict';
window.ChatUsagePanel = (() => {
  const { el, button } = window.ChatDom;
  let ctx = null; let say = null; let section = null;

  function usage() {
    const u = ctx.usage(); const s = section('Usage');
    const today = el('progress'); today.max = u.cap; today.value = Math.min(u.spent, u.cap); today.setAttribute('aria-label', 'Spent today');
    const big = el('p', 'panel-big num', `About $${u.spent.toFixed(2)} `); big.append(el('span', 'muted', `of $${u.cap} today`));
    s.append(big, today, el('p', 'num', `This chat: about $${(u.chatUsd ?? 0).toFixed(2)}`));
    if (u.contextPct == null) s.append(el('p', 'muted', 'Memory used: shows after the first reply.'));
    else {
      const m = el('progress'); m.max = 100; m.value = u.contextPct; m.setAttribute('aria-label', 'Memory used');
      s.append(el('p', 'num', `Memory used: ${u.contextPct}%`), m);
    }
    // The fine print folds away: read it once, and the figures above are all you need after that.
    const more = el('details', 'panel-more');
    more.append(el('summary', '', 'How these numbers work'),
      el('p', 'panel-note', `Model: ${u.model}. Costs are an estimate from list prices and update when each reply finishes. `
        + 'Jobs sent to the Claude app use your subscription and aren\'t counted here.'),
      el('p', 'panel-note', 'Your Anthropic Console shows the exact bill, which can take a few hours to catch up. '
        + 'Spending stops at the daily cap and starts over at midnight. A long chat uses more memory; a new chat starts fresh.'));
    s.append(more, button('Open Console usage', 'btn btn-small btn-quiet', () => ctx.api.openLearn('https://platform.claude.com/usage').then(say)));
    return s;
  }
  function about(u) {
    const s = section('This app');
    s.append(el('p', 'panel-note', 'Right-click the menu bar icon to quit, or to start the app when your Mac starts.'));
    if (u.version) s.append(el('p', 'panel-note', `Menu Bar Chat version ${u.version}`)); // so a test can tell which build is running
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

  /** The panel's sections, top to bottom. `sec` makes a titled section (panel.js). */
  function sections(c, s, sec) { ctx = c; say = s; section = sec; return [usage(), learning(), about(ctx.usage())]; }
  return { sections };
})();
