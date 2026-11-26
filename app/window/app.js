// app.js - the chat window: one chat box, no shell box. Plain script, runs sandboxed with only
// window.menubarChat. The parts live in dom.js, log.js (the conversation) and cards.js (approvals).
'use strict';
(() => {
  const api = window.menubarChat;
  const { $, el, button } = window.ChatDom;
  const Log = window.ChatLog; const Cards = window.ChatCards; const Panel = window.ChatPanel;

  const state = { projects: [], current: null, busy: new Set(), modes: new Map(), cards: new Map(), chat: new Map(), spent: 0, cap: 5, model: 'Sonnet' };
  const MODE = {
    default: ['Ask me first', 'Every change and command asks you first.'],
    plan: ['Plan first', 'Claude only reads and plans, then asks you to approve the plan.'],
    dev: ['Dev mode', 'Claude goes ahead on steps inside this project folder. It still asks for anything outside it, deletes, the internet and system tools.'],
  };
  const said = (r) => { if (r && r.ok === false) notice(r.error || r.text, true); };

  // One line above the chat box. A plain note clears itself; a problem stays until you close it.
  let noticeTimer = null;
  function notice(text, bad, fix) {
    const n = $('notice'); clearTimeout(noticeTimer);
    if (!text) { n.hidden = true; n.replaceChildren(); return; }
    n.replaceChildren(el('span', 'notice-text', text)); n.className = bad ? 'notice bad' : 'notice'; n.hidden = false;
    if (fix) n.append(button(fix[0], 'btn btn-small', () => { notice(''); fix[1](); }));
    if (bad) n.append(button('Close', 'btn btn-small btn-quiet', () => notice('')));
    else noticeTimer = setTimeout(() => notice(''), 5000);
  }
  const last = new Map(); // project -> its last result, e.g. "Put away · Done · 4:02 PM"
  const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function result(project, what) { if (project) { last.set(project, `${what} · ${clock()}`); showStatus(); } }
  // What's happening in this project next to Send (or what last happened); and how many cards wait behind this one.
  function showStatus() {
    const mine = [...state.cards.values()].filter((c) => c.project === state.current).length;
    const others = new Set([...state.cards.values()].map((c) => c.project).filter((p) => p !== state.current));
    const here = mine ? 'Waiting on you' : state.busy.has(state.current) ? 'Claude is working…' : last.get(state.current) || '';
    const away = others.size ? `${here ? 'Also waiting' : 'Waiting'} in ${[...others].join(', ')}` : '';
    $('status').textContent = [here, away].filter(Boolean).join(' · '); $('status').title = $('status').textContent;
    const q = $('cards').querySelector('.queue') || $('cards').appendChild(el('p', 'queue'));
    q.textContent = mine > 1 ? `1 of ${mine} waiting. The next one shows when you answer this one.` : ''; q.hidden = mine < 2;
  }
  function showMode() {
    const m = state.modes.get(state.current) || 'default';
    $('mode').value = m; $('mode').title = MODE[m][1]; $('mode').classList.toggle('mode-on', m !== 'default');
  }
  function showSpend(spent, cap) {
    $('spend').textContent = `About $${spent.toFixed(2)} of $${cap} today`; $('spend').title = 'An estimate. Click for details and your exact bill.';
    $('spend').classList.toggle('near', spent >= cap * 0.8);
    state.spent = spent; state.cap = cap; Panel.refresh();
  }
  function setBusy(project, busy) {
    if (busy) state.busy.add(project); else state.busy.delete(project);
    if (project === state.current) $('stop').disabled = !busy;
    showStatus();
  }

  function selectProject(name) {
    state.current = name; $('project').textContent = name;
    $('send').disabled = false; $('input').disabled = false;
    const p = state.projects.find((x) => x.name === name);
    $('tag').textContent = p?.tag === 'personal' ? 'personal' : 'work';
    $('stop').disabled = !state.busy.has(name);
    for (const [, c] of state.cards) c.node.hidden = c.project !== name;
    showMode(); Log.show(name); showStatus();
    if (state.warm) api.warm(name).catch(() => {}); // start Claude Code now, so the first reply is quicker
  }

  function sendText(project, text) {
    Log.you(project, text);
    api.send(project, text).then(said);
    setBusy(project, true);
  }
  function send() {
    const text = $('input').value.trim();
    if (!text || !state.current) return;
    sendText(state.current, text);
    $('input').value = ''; activity();
  }
  let hovered = false;
  const activity = () => api.activity({ hovered, typing: document.activeElement === $('input') && $('input').value.length > 0 });

  function openCard(project, card) {
    const node = Cards.render(project, card, {
      answer: (decision) => { Cards.settle(node); api.answer(project, card.id, decision).then(said); },
      copy: (t) => { api.copy(t); notice('Copied.'); },
      learn: (u) => api.openLearn(u).then(said),
    });
    node.hidden = project !== state.current;
    state.cards.set(card.id, { node, project });
    $('cards').append(node); showStatus();
    if (project !== state.current) notice(`Waiting on you in ${project}.`);
  }
  function closeCard(id) { state.cards.get(id)?.node.remove(); state.cards.delete(id); showStatus(); }

  const NOT_SENT = new Set(['empty', 'slash-typo', 'slash-unknown', 'slash-app', 'slash-terminal']);
  // A mistyped /command: the one-line fix comes with a button that puts the right one in the box.
  function hint(p, ev) {
    let fix = null;
    if (ev.kind === 'slash-typo' && ev.suggestion) {
      fix = button(`Use /${ev.suggestion}`, 'btn btn-small btn-quiet', () => { $('input').value = `/${ev.suggestion}`; $('input').focus(); });
    }
    Log.line(p, ev.text, 'line-hint', fix);
    if (NOT_SENT.has(ev.kind)) setBusy(p, false);
  }

  function onEvent(ev) {
    const p = ev.project;
    switch (ev.type) {
      case 'text': Log.text(p, ev.text); break;
      case 'tool': Log.line(p, ev.line); break;
      case 'approval': openCard(p, ev.card); break;
      case 'approval_closed':
        closeCard(ev.id); if (ev.decision === 'merged') break;
        Log.line(p, ev.decision === 'allow' ? 'You allowed it once.' : (ev.why || 'Not run.')); break;
      case 'blocked': Log.line(p, `Blocked: ${ev.plain}`, 'line-blocked'); break;
      case 'tool_failed': Log.line(p, ev.text); break;
      case 'hint': hint(p, ev); break;
      case 'handoff': Log.line(p, ev.line); break;
      case 'suggestions': Log.next(p, (ev.items || []).slice(0, 3), (item) => sendText(p, item)); break;
      case 'past': Log.reset(p); Log.past(p, ev.turns || []); state.chat.delete(p);
        Log.line(p, 'Picked up this chat. Anything you send carries on from here.'); break;
      case 'session': if (ev.sessionId === null) { setBusy(p, false); Log.reset(p); Log.line(p, 'New chat started.'); state.chat.delete(p); } break;
      case 'change': Log.change(p, ev, (id) => api.undo(p, id).then(said)); break;
      case 'undo_result': if (ev.ok) Log.undone(ev.id); Log.line(p, ev.text, ev.ok ? '' : 'line-blocked'); break;
      case 'mode':
        state.modes.set(p, ev.mode); if (p === state.current) showMode();
        Log.line(p, `Mode: ${ev.label}. ${MODE[ev.mode]?.[1] || ''}`.trim()); break;
      case 'why': if (!ev.seen) Log.line(p, 'No "Why:" line came before this change.'); break;
      case 'usage': state.chat.set(p, { chatUsd: ev.chatUsd, contextPct: ev.contextPct }); Panel.refresh(); break;
      case 'turn_done': Log.endReply(p); setBusy(p, false); showSpend(ev.spentUsd, ev.capUsd);
        result(p, ev.ok === false ? 'Reply · Stopped' : 'Reply · Done'); break;
      case 'error': setBusy(p, false); notice(`${p}: ${ev.text}`, true); Log.line(p, ev.text, 'line-blocked'); result(p, 'Reply · Stopped'); break;
      case 'opened': $('input').focus(); Log.fit(); break;
      default: break;
    }
  }

  /** Selects the first project whose folder is on this Mac; false when there is none. */
  function pickFirst() {
    const first = state.projects.find((x) => !x.away);
    if (first) { selectProject(first.name); return true; }
    state.current = null; $('project').textContent = 'Project'; $('send').disabled = true; $('input').disabled = true;
    notice(state.projects.length ? 'Your projects are put away on GitHub. Click Project and pick one to copy it back.'
      : 'No projects yet. Click Project, then Add a folder.', true);
    return false;
  }

  function setProjects(list) {
    state.projects = list;
    const p = list.find((x) => x.name === state.current);
    if (p) $('tag').textContent = p.tag;
  }

  async function start() {
    Log.init(api, { fill: (t) => { $('input').value = t; $('input').focus(); activity(); }, copy: (t) => { api.copy(t); notice('Copied.'); } });
    Panel.init({
      api, notice, result, copy: (t) => { api.copy(t); notice('Copied.'); }, select: selectProject, setProjects, pickFirst,
      busy: (n) => state.busy.has(n), projects: () => state.projects, current: () => state.current,
      usage: () => ({ spent: state.spent, cap: state.cap, model: state.model, version: state.version, ...(state.chat.get(state.current) || {}) }),
    });
    api.onEvent(onEvent);
    const info = (await api.init()) || {};
    state.projects = info.projects || [];
    state.model = info.model || 'Sonnet'; state.version = info.versions?.app || '';
    showSpend(info.spentUsd ?? 0, info.capUsd ?? 5);
    state.warm = info.keychainOk === true;
    $('spend').title = 'Spending today. Click for this chat and how much memory it has used.';
    if (!pickFirst()) return;
    const openCheckup = ['Open Checkup', () => Panel.show('checkup')];
    if (!info.keychainOk) notice('No API key in the Keychain yet, so Claude can\'t answer. Press Open Checkup for the fix.', true, openCheckup);
    else if (!info.hotkey) notice('The hotkey Control-Option-Command-C is taken by another app. The menu bar icon still works.');
  }

  $('composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $('input').addEventListener('input', activity);
  $('input').addEventListener('blur', activity);
  $('stop').addEventListener('click', () => state.current && api.stop(state.current).then(said));
  $('mode').addEventListener('change', () => {
    if (!state.current) return;
    api.setMode(state.current, $('mode').value).then((r) => { said(r); if (r?.ok === false) showMode(); }); // a refused change puts the menu back
  });
  document.addEventListener('mouseenter', () => { hovered = true; activity(); });
  document.addEventListener('mouseleave', () => { hovered = false; activity(); });
  // Esc closes an open panel or "Show the exact command" first; otherwise it tucks the window away.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (Panel.close()) return; // an open panel closes first
    const open = document.activeElement?.closest?.('details[open]');
    if (open) { open.open = false; open.querySelector('summary')?.focus(); return; }
    api.hide();
  });

  start();
})();
