// checkup-panel.js - the Checkup panel, opened from Checkup in the top bar. Plain script.
// One look at whether the app can work: the title with a pill, one plain line, one button, the counts,
// then rows grouped as This Mac and the current project. Every check only looks; nothing changes.
// A problem row ends with the button that fixes it; a long path waits behind Details.
'use strict';
window.ChatCheckupPanel = (() => {
  const { el, button } = window.ChatDom;
  const MARK = { pass: '✓', warn: '!', fail: '✕', info: 'i' };
  const WORD = { pass: 'Pass', warn: 'Warn', fail: 'Fail', info: 'Info' };
  const PILL = { pass: ['Passed', 'pill'], warn: ['Look at', 'pill pill-warn'], fail: ['Failed', 'pill pill-danger'] };
  let last = null; // the latest result, so the panel opens with it while a fresh check runs

  function rowEl(r, ctx) {
    const li = el('li', `check-row check-${r.status}`);
    const mark = el('span', 'check-mark', MARK[r.status]); mark.setAttribute('aria-hidden', 'true');
    const body = el('div', 'check-body');
    const text = el('p', 'check-text'); text.append(el('span', 'check-label', `${WORD[r.status]} · ${r.label}`), el('span', '', r.text));
    body.append(text);
    if (r.copy) {
      const more = el('details', 'check-more'); more.append(el('summary', '', 'Show the command'), el('code', 'check-code', r.copy));
      body.append(more, button('Copy command', 'btn btn-small', () => ctx.copy(r.copy)));
    } else if (r.detail) {
      const more = el('details', 'check-more'); more.append(el('summary', '', 'Details'), el('code', 'check-code', r.detail));
      body.append(more);
    }
    li.append(mark, body);
    return li;
  }
  function groupEl(g, ctx) {
    const box = el('div', 'check-group'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', g.name);
    const n = { fail: 0, warn: 0 }; for (const r of g.rows) if (r.status in n) n[r.status] += 1;
    const tally = n.fail ? `${n.fail} fail` : n.warn ? `${n.warn} to look at` : 'All pass';
    const head = el('div', 'check-head'); head.append(el('h3', 'check-group-name', g.name), el('span', 'muted', tally));
    const list = el('ul', 'check-list'); list.append(...g.rows.map((r) => rowEl(r, ctx)));
    box.append(head, list);
    return box;
  }
  function fill(s, r, ctx) {
    const [word, cls] = PILL[r.verdict];
    const title = el('div', 'check-title'); title.append(el('h2', 'panel-title', 'Checkup'), el('span', cls, word));
    const c = r.counts;
    s.replaceChildren(title, el('p', '', r.summary), run(s, ctx),
      el('p', 'muted num', `Pass ${c.pass} · Warn ${c.warn} · Fail ${c.fail} · Info ${c.info}`), ...r.groups.map((g) => groupEl(g, ctx)));
  }
  function run(s, ctx) {
    return button('Run checkup', 'btn', async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Checking…';
      const r = await ctx.api.checkup(ctx.current());
      if (!r?.ok) {
        ctx.notice(r?.error || 'The checkup didn\'t run. Press Run checkup again.', true);
        b.disabled = false; b.textContent = 'Run checkup'; return;
      }
      last = r; fill(s, r, ctx);
      ctx.result(ctx.current(), `Checkup · ${r.verdict === 'pass' ? 'Passed' : r.summary.replace(/\.$/, '')}`);
      s.querySelector('.check-title')?.focus?.();
    });
  }

  /** The panel's one section. It runs the checks as it opens; they take a moment because of GitHub. */
  function sections(ctx, say, section) {
    const s = section('Checkup'); s.classList.add('checkup');
    if (last) fill(s, last, ctx);
    else s.append(el('p', 'muted', 'Checks your API key, the background helper, GitHub, today\'s spend and this project. It changes nothing.'), run(s, ctx));
    queueMicrotask(() => s.querySelector('.checkup > .btn')?.click());
    return [s];
  }
  return { sections };
})();
