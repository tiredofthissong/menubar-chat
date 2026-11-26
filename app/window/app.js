// app.js - the window. Plain script (no imports), runs sandboxed with only window.menubarChat.
// Every piece of text from Claude or a file goes in with textContent, never innerHTML.
'use strict';
(() => {
  const api = window.menubarChat;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // The nine checks from the v1 plan's Mac test (step 13).
  const CHECKS = [
    { id: 'popup', name: 'Pops up in under 1 second', how: 'Click the menu bar icon, then press Control-Option-Command-C. Do each a few times.' },
    { id: 'tuck', name: 'Tucks away the usual ways', how: 'Each should hide it: press Esc, click somewhere else, press the hotkey again.' },
    { id: 'autotuck', name: 'Tucks itself away after a reply', how: 'Send a message and move the pointer off the window. It hides about 5 seconds after the reply, but not while you hover, type, or have a card open.' },
    { id: 'icon', name: 'Icon moves, and holds still with Reduce Motion', how: 'Watch the icon while Claude works. Then turn on System Settings > Accessibility > Display > Reduce motion and try again.' },
    { id: 'hover', name: 'Hover line says what is happening', how: 'Hold the pointer over the menu bar icon while Claude works and while a card waits.' },
    { id: 'chain', name: 'A chained command arrives as one card that lists every step', how: 'Try it on personal-demo. You should see one card with three numbered steps.', tryIt: { project: 'personal-demo', prompt: 'Get the latest changes from origin, make the folder .claude/skills/demo-skill, and copy kit/demo-skill/SKILL.md into it. Use one shell command joined with &&.' } },
    { id: 'why', name: 'An edit comes with a "Why:" line', how: 'Try it on personal-demo. Look for a green "Why:" line before the change card.', tryIt: { project: 'personal-demo', prompt: 'Fix the spelling mistake in notes.txt.' } },
    { id: 'push', name: 'A push on a work project is blocked', how: 'Try it on work-demo. Approve the edit and commit; the push should be refused without a card.', tryIt: { project: 'work-demo', prompt: "Add a line 'checked' to notes.txt, commit it, and push it to origin." } },
    { id: 'notify', name: 'A notification appears while the window is hidden', how: 'Send a message that needs a change, then hide the window before the card shows. Click Review on the notification.' },
  ];

  const state = {
    projects: [], current: null, info: null,
    results: Object.fromEntries(CHECKS.map((c) => [c.id, { mark: null, auto: '' }])),
    opens: [], logs: new Map(), bubble: new Map(), busy: new Set(), lastTry: new Map(), cards: new Map(),
  };

  // ---- Notices ----
  function notice(text, bad) {
    const n = $('notice');
    if (!text) { n.hidden = true; return; }
    n.textContent = text; n.className = bad ? 'notice bad' : 'notice'; n.hidden = false;
  }

  // ---- Log per project ----
  function logFor(project) {
    if (!state.logs.has(project)) {
      const box = el('div', 'project-log');
      box.append(el('p', 'empty', 'Ask for something small in this test project. Anything that changes a file or runs a command asks you first.'));
      state.logs.set(project, box);
    }
    return state.logs.get(project);
  }
  // Scrolling: follow new messages only while you're at the bottom (see scroll.js).
  const S = window.ChatScroll;
  let stick = true;
  const jump = el('button', 'jump btn btn-small', 'Jump to latest'); jump.type = 'button'; jump.hidden = true;
  function toBottom() { const log = $('log'); log.scrollTop = log.scrollHeight; stick = true; jump.hidden = true; }
  function followIfStuck() { if (stick) toBottom(); else jump.hidden = false; }
  function showLog() {
    $('log').replaceChildren(logFor(state.current), jump);
    toBottom();
  }
  function add(project, node) {
    const box = logFor(project); box.querySelector('.empty')?.remove();
    box.append(node);
    if (project === state.current) followIfStuck();
  }
  function addText(project, text) {
    let b = state.bubble.get(project);
    if (!b) { b = el('div', 'msg msg-claude', ''); state.bubble.set(project, b); add(project, b); }
    b.textContent += text;
    if (project === state.current) followIfStuck();
  }
  const addLine = (project, text, cls = '') => { state.bubble.delete(project); add(project, el('div', `line ${cls}`.trim(), text)); };

  // ---- Approval cards ----
  function renderCard(project, card) {
    const c = el('article', card.danger ? 'card danger' : 'card');
    c.setAttribute('aria-label', `Waiting on you in ${project}`);
    c.append(el('div', 'card-title', `Waiting on you · ${project}`));
    c.append(el('p', '', card.plain || `Use ${card.toolName}.`));
    if (Array.isArray(card.steps) && card.steps.length > 1) {
      const ol = el('ol', 'card-steps');
      for (const s of card.steps) ol.append(el('li', /^(sudo\s+)?rm\b/.test(s) ? 'danger' : '', s));
      c.append(ol);
    }
    if (card.command) {
      const d = el('details'); d.append(el('summary', '', 'Exact command'), el('code', '', card.command));
      c.append(d);
    }
    const row = el('div', 'card-actions');
    // Same look for both, and nothing pre-selected: a stray Enter can't approve.
    const deny = el('button', 'btn', 'Deny'); deny.type = 'button';
    const allow = el('button', 'btn', 'Allow once'); allow.type = 'button';
    deny.addEventListener('click', () => api.answer(project, card.id, 'deny'));
    allow.addEventListener('click', () => api.answer(project, card.id, 'allow'));
    row.append(deny, allow); c.append(row);
    state.cards.set(card.id, c);
    $('cards').append(c);
  }

  // ---- Checklist ----
  function renderChecks() {
    const ol = $('checks'); ol.replaceChildren();
    for (const c of CHECKS) {
      const li = el('li', 'check'); li.dataset.id = c.id;
      li.append(el('div', 'check-name', c.name), el('div', 'check-how', c.how));
      const auto = el('div', 'check-auto', state.results[c.id].auto); auto.dataset.auto = c.id; li.append(auto);
      const row = el('div', 'check-row');
      for (const [mark, label] of [['pass', 'Pass'], ['fail', 'Fail']]) {
        const b = el('button', `btn btn-small ${mark}`, label); b.type = 'button';
        b.setAttribute('aria-pressed', String(state.results[c.id].mark === mark));
        b.addEventListener('click', () => { state.results[c.id].mark = state.results[c.id].mark === mark ? null : mark; saveMarks(); renderChecks(); });
        row.append(b);
      }
      if (c.tryIt) {
        const t = el('button', 'btn btn-small btn-quiet', 'Try it'); t.type = 'button';
        t.addEventListener('click', () => tryIt(c));
        row.append(t);
      }
      li.append(row); ol.append(li);
    }
  }
  function setAuto(id, text) {
    state.results[id].auto = text;
    const n = document.querySelector(`[data-auto="${id}"]`); if (n) n.textContent = text;
  }
  function tryIt(check) {
    const p = state.projects.find((x) => x.name === check.tryIt.project);
    if (!p) { notice(`There's no ${check.tryIt.project} project. Run "npm run scratch" first.`, true); return; }
    selectProject(p.name);
    $('input').value = check.tryIt.prompt; $('input').focus(); sendActivity();
    state.lastTry.set(p.name, check.id);
  }

  // ---- Results ----
  function resultsText() {
    const i = state.info || {};
    const lines = ['# Menu bar chat: first Mac test', '',
      `- App ${i.versions?.app || '?'} · Electron ${i.versions?.electron || '?'} · ${i.versions?.os || '?'}`,
      `- Key in Keychain: ${i.keychainOk ? 'yes' : 'no'} · Hotkey: ${i.hotkey || 'not registered'} · Reduce Motion: ${i.reducedMotion ? 'on' : 'off'}`,
      `- Spent: ${$('spend').textContent}`, ''];
    CHECKS.forEach((c, n) => {
      const r = state.results[c.id];
      lines.push(`${n + 1}. ${r.mark === 'pass' ? 'PASS' : r.mark === 'fail' ? 'FAIL' : 'not marked'} · ${c.name}${r.auto ? ` (app saw: ${r.auto})` : ''}`);
    });
    return lines.join('\n');
  }

  // ---- Sending ----
  function selectProject(name) {
    state.current = name; $('project').value = name;
    const p = state.projects.find((x) => x.name === name);
    $('tag').textContent = p?.tag === 'personal' ? 'personal' : 'work';
    $('stop').disabled = !state.busy.has(name);
    showLog();
  }
  function send() {
    const text = $('input').value.trim();
    if (!text || !state.current) return;
    if (!state.lastTry.has(state.current)) state.lastTry.set(state.current, null);
    state.bubble.delete(state.current);
    stick = true; // your own message always brings you back to the newest
    add(state.current, el('div', 'msg msg-you', text));
    api.send(state.current, text);
    state.busy.add(state.current); $('stop').disabled = false;
    $('input').value = ''; sendActivity();
  }
  let hovered = false;
  const sendActivity = () => api.activity({ hovered, typing: document.activeElement === $('input') && $('input').value.length > 0, pinned: $('pin').checked });

  // ---- Events from the app ----
  const turnApprovals = new Map();
  function onEvent(ev) {
    const p = ev.project;
    switch (ev.type) {
      case 'text': addText(p, ev.text); break;
      case 'tool': addLine(p, ev.line); break;
      case 'approval':
        turnApprovals.set(p, { count: (turnApprovals.get(p)?.count || 0) + 1, steps: Math.max(turnApprovals.get(p)?.steps || 0, ev.card.steps?.length || 0) });
        renderCard(p, ev.card);
        if (p !== state.current) notice(`Waiting on you in ${p}.`);
        break;
      case 'approval_closed': {
        state.cards.get(ev.id)?.remove(); state.cards.delete(ev.id);
        addLine(p, ev.decision === 'allow' ? 'You allowed it once.' : (ev.why || 'Not run.'));
        break;
      }
      case 'blocked':
        addLine(p, `Blocked: ${ev.plain}`, 'line-blocked');
        if (/push/i.test(`${ev.rule} ${ev.plain}`)) setAuto('push', `push refused before any card (${ev.rule})`);
        break;
      case 'tool_failed': addLine(p, ev.text); break;
      case 'why':
        addLine(p, ev.seen ? `Why: ${ev.why}` : 'No "Why:" line came before this change.', ev.seen ? 'line-why' : '');
        setAuto('why', ev.seen ? `Why line seen: "${ev.why.slice(0, 60)}"` : 'edit arrived with no Why line');
        break;
      case 'turn_done': {
        state.bubble.delete(p); state.busy.delete(p);
        if (p === state.current) $('stop').disabled = true;
        const spend = $('spend');
        spend.textContent = `$${ev.spentUsd.toFixed(2)} of $${ev.capUsd}`;
        spend.classList.toggle('near', ev.spentUsd >= ev.capUsd * 0.8);
        const t = turnApprovals.get(p); turnApprovals.delete(p);
        if (state.lastTry.get(p) === 'chain') setAuto('chain', t ? `${t.count} card(s), ${t.steps} steps listed` : 'no card appeared');
        state.lastTry.delete(p);
        break;
      }
      case 'error':
        state.busy.delete(p); if (p === state.current) $('stop').disabled = true;
        notice(`${p}: ${ev.text}`, true); addLine(p, ev.text, 'line-blocked');
        break;
      case 'opened': {
        if (typeof ev.ms === 'number') {
          state.opens.push(ev.ms);
          const worst = Math.max(...state.opens);
          setAuto('popup', `${state.opens.length} opens, slowest ${worst} ms${worst < 1000 ? '' : ' (over 1 second)'}`);
        }
        $('input').focus(); fit();
        break;
      }
      case 'notified': setAuto('notify', `notification sent for ${p}`); break;
      default: break;
    }
  }

  // ---- Window size: grow to fit the conversation and cards, so the chat box never gets cut off ----
  let fitQueued = false;
  const sizeChanged = S.makeSizeGate();
  function fit() {
    if (fitQueued) return; fitQueued = true;
    requestAnimationFrame(() => {
      fitQueued = false;
      // Natural heights, not the squeezed ones, so growing the window doesn't feed back on itself.
      const log = $('log'); const cards = $('cards'); const notice = $('notice');
      const logContent = (log.firstElementChild?.offsetHeight || 0) + 24; // content plus the log's own padding
      const cardsContent = cards.childElementCount ? cards.scrollHeight : 0;
      const noticeHeight = notice.hidden ? 0 : notice.offsetHeight + 12; // plus its top margin
      const wanted = Math.ceil(document.querySelector('.bar').offsetHeight + noticeHeight + logContent + cardsContent + $('composer').offsetHeight);
      if (sizeChanged(wanted)) api.fit(wanted); // the same size again would only resize the window for nothing
    });
  }
  new ResizeObserver(() => { if (stick) toBottom(); }).observe($('log')); // the window grew or shrank: stay at the newest if you were there

  // Reading back: any scroll away from the bottom stops the follow; a wheel turn that didn't move
  // the conversation is applied by hand (backup for trackpads and mice).
  $('log').addEventListener('scroll', () => { stick = S.isAtBottom($('log')); jump.hidden = stick; }, { passive: true });
  $('log').addEventListener('wheel', (ev) => {
    const log = $('log'); const before = log.scrollTop; const px = S.wheelPixels(ev, log.clientHeight);
    requestAnimationFrame(() => requestAnimationFrame(() => S.fallbackScroll(log, before, px)));
  }, { passive: true });
  jump.addEventListener('click', toBottom);
  new ResizeObserver(fit).observe($('cards'));
  new MutationObserver(fit).observe($('log'), { childList: true, subtree: true, characterData: true });
  new ResizeObserver(fit).observe($('notice'));

  // ---- Remember Pass/Fail marks across restarts (this Mac only) ----
  const MARKS_KEY = 'proving-marks-v1';
  try {
    const saved = JSON.parse(localStorage.getItem(MARKS_KEY) || '{}');
    for (const [id, mark] of Object.entries(saved)) if (state.results[id] && (mark === 'pass' || mark === 'fail')) state.results[id].mark = mark;
  } catch { /* nothing saved, or storage unavailable */ }
  const saveMarks = () => {
    try { localStorage.setItem(MARKS_KEY, JSON.stringify(Object.fromEntries(Object.entries(state.results).map(([id, r]) => [id, r.mark])))); } catch { /* fine */ }
  };

  // ---- Wiring ----
  async function start() {
    renderChecks();
    api.onEvent(onEvent);
    const info = await api.init();
    state.info = info || {};
    state.projects = info?.projects || [];
    const sel = $('project');
    for (const p of state.projects) sel.append(el('option', '', p.name));
    $('spend').textContent = `$0.00 of $${info?.capUsd ?? 5}`;
    if (!state.projects.length) {
      notice('No test projects yet. In Terminal, run "npm run scratch", then quit and reopen the app.', true);
      $('send').disabled = true; $('input').disabled = true;
    } else {
      selectProject(state.projects[0].name);
      if (!info.keychainOk) notice('No API key in the Keychain yet. Do step 7 of the Mac test, then quit and reopen.', true);
      else if (!info.hotkey) notice('The hotkey Control-Option-Command-C is taken by another app. The menu bar icon still works.');
    }
    if (info?.reducedMotion) setAuto('icon', 'Reduce Motion is on, so the icon should hold still');
  }

  $('project').addEventListener('change', (e) => selectProject(e.target.value));
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $('input').addEventListener('input', sendActivity);
  $('input').addEventListener('blur', sendActivity);
  $('pin').addEventListener('change', sendActivity);
  $('stop').addEventListener('click', () => state.current && api.stop(state.current));
  $('copy').addEventListener('click', () => { api.copy(resultsText()); notice('Results copied. Paste them in our chat.'); });
  $('save').addEventListener('click', async () => { const f = await api.saveResults(resultsText()); if (f) notice('Saved as proving-results.md in the app folder.'); });
  document.addEventListener('mouseenter', () => { hovered = true; sendActivity(); });
  document.addEventListener('mouseleave', () => { hovered = false; sendActivity(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.hide(); });

  start();
})();
