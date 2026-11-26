// app.js - the chat window: one chat box, no shell box. Plain script, runs sandboxed with only
// window.menubarChat. The parts live in dom.js, log.js (the conversation) and cards.js (approvals).
'use strict';
(() => {
  const api = window.menubarChat;
  const { $, el, button } = window.ChatDom;
  const Log = window.ChatLog; const Cards = window.ChatCards;

  const state = { projects: [], current: null, busy: new Set(), modes: new Map(), cards: new Map() };
  const MODE = {
    default: ['Ask me first', 'Every change asks you first. Click for Plan first: Claude only reads and plans until you approve the plan.'],
    plan: ['Plan first', 'Claude only reads and plans, then asks you to approve the plan. Click to go back to Ask me first.'],
  };
  const said = (r) => { if (r && r.ok === false) notice(r.error || r.text, true); };

  function notice(text, bad) {
    const n = $('notice');
    if (!text) { n.hidden = true; return; }
    n.textContent = text; n.className = bad ? 'notice bad' : 'notice'; n.hidden = false;
  }
  function showMode() {
    const m = state.modes.get(state.current) || 'default';
    $('mode').textContent = MODE[m][0]; $('mode').title = MODE[m][1]; $('mode').setAttribute('aria-pressed', String(m === 'plan'));
  }
  function showSpend(spent, cap) {
    $('spend').textContent = `$${spent.toFixed(2)} of $${cap} today`;
    $('spend').classList.toggle('near', spent >= cap * 0.8);
  }
  function setBusy(project, busy) {
    if (busy) state.busy.add(project); else state.busy.delete(project);
    if (project === state.current) $('stop').disabled = !busy;
  }

  function selectProject(name) {
    state.current = name; $('project').value = name;
    const p = state.projects.find((x) => x.name === name);
    $('tag').textContent = p?.tag === 'personal' ? 'personal' : 'work';
    $('stop').disabled = !state.busy.has(name);
    for (const [, c] of state.cards) c.node.hidden = c.project !== name;
    showMode(); Log.show(name);
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
      copy: (t) => { api.copy(t); notice('Command copied.'); },
    });
    node.hidden = project !== state.current;
    state.cards.set(card.id, { node, project });
    $('cards').append(node);
    if (project !== state.current) notice(`Waiting on you in ${project}.`);
  }
  function closeCard(id) { state.cards.get(id)?.node.remove(); state.cards.delete(id); }

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
      case 'approval_closed': closeCard(ev.id); Log.line(p, ev.decision === 'allow' ? 'You allowed it once.' : (ev.why || 'Not run.')); break;
      case 'blocked': Log.line(p, `Blocked: ${ev.plain}`, 'line-blocked'); break;
      case 'tool_failed': Log.line(p, ev.text); break;
      case 'hint': hint(p, ev); break;
      case 'suggestions': Log.next(p, (ev.items || []).slice(0, 3), (item) => sendText(p, item)); break;
      case 'session': if (ev.sessionId === null) { setBusy(p, false); Log.line(p, 'New chat started.'); } break;
      case 'change': Log.change(p, ev, (id) => api.undo(p, id).then(said)); break;
      case 'undo_result': if (ev.ok) Log.undone(ev.id); Log.line(p, ev.text, ev.ok ? '' : 'line-blocked'); break;
      case 'mode': state.modes.set(p, ev.mode); if (p === state.current) showMode(); Log.line(p, `Mode: ${ev.label}.`); break;
      case 'why': if (!ev.seen) Log.line(p, 'No "Why:" line came before this change.'); break;
      case 'usage':
        $('spend').title = `Model: Sonnet. This chat: $${(ev.chatUsd ?? 0).toFixed(2)}${ev.contextPct == null ? '' : `, ${ev.contextPct}% of its memory used`}. Spending stops at the daily cap and starts over at midnight.`;
        break;
      case 'turn_done': Log.endReply(p); setBusy(p, false); showSpend(ev.spentUsd, ev.capUsd); break;
      case 'error': setBusy(p, false); notice(`${p}: ${ev.text}`, true); Log.line(p, ev.text, 'line-blocked'); break;
      case 'opened': $('input').focus(); Log.fit(); break;
      default: break;
    }
  }

  async function start() {
    Log.init(api);
    api.onEvent(onEvent);
    const info = (await api.init()) || {};
    state.projects = info.projects || [];
    for (const p of state.projects) $('project').append(el('option', '', p.name));
    showSpend(info.spentUsd ?? 0, info.capUsd ?? 5);
    $('spend').title = `Model: ${info.model || 'Sonnet'}. Spending stops at the daily cap and starts over at midnight.`;
    if (!state.projects.length) {
      notice('No projects yet. In Terminal, run "npm run scratch", then quit and reopen the app.', true);
      $('send').disabled = true; $('input').disabled = true;
      return;
    }
    selectProject(state.projects[0].name);
    if (!info.keychainOk) notice('No API key in the Keychain yet, so Claude can\'t answer. See the README, then quit and reopen.', true);
    else if (!info.hotkey) notice('The hotkey Control-Option-Command-C is taken by another app. The menu bar icon still works.');
  }

  $('project').addEventListener('change', (e) => selectProject(e.target.value));
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $('input').addEventListener('input', activity);
  $('input').addEventListener('blur', activity);
  $('stop').addEventListener('click', () => state.current && api.stop(state.current).then(said));
  $('mode').addEventListener('click', () => {
    if (!state.current) return;
    api.setMode(state.current, (state.modes.get(state.current) || 'default') === 'plan' ? 'default' : 'plan').then(said);
  });
  document.addEventListener('mouseenter', () => { hovered = true; activity(); });
  document.addEventListener('mouseleave', () => { hovered = false; activity(); });
  // Esc tucks the window away, unless it's closing an open "Show the exact command" first.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.activeElement?.closest?.('details[open]');
    if (open) { open.open = false; open.querySelector('summary')?.focus(); return; }
    api.hide();
  });

  start();
})();
