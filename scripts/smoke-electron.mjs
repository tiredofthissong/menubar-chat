// smoke-electron.mjs - DEVELOPER CHECK ONLY: starts the real app, reads what the window shows,
// prints it, and quits. Run: npx electron scripts/smoke-electron.mjs
import { app, BrowserWindow } from 'electron';
import '../app/main.mjs';
import { learnFor } from '../shared/learn.mjs';

app.whenReady().then(() => setTimeout(async () => {
  const w = BrowserWindow.getAllWindows()[0];
  const seen = await w.webContents.executeJavaScript(`({
    project: document.getElementById('project').textContent,
    tag: document.getElementById('tag').textContent,
    chatBoxes: document.querySelectorAll('textarea').length,
    sidePanels: document.querySelectorAll('aside').length,
    width: window.innerWidth,
    notice: document.getElementById('notice').hidden ? '' : document.getElementById('notice').textContent,
    spend: document.getElementById('spend').textContent,
  })`);
  console.log('SMOKE ' + JSON.stringify(seen));
  // The background helper: a command from the window goes through the app to the helper and back.
  const roundTrip = await w.webContents.executeJavaScript(`(async () => {
    const p = document.getElementById('project').textContent;
    return { undo: await window.menubarChat.undo(p, 'no-such-change'), mode: await window.menubarChat.setMode(p, 'bypassPermissions') };
  })()`);
  console.log('SMOKE-HELPER ' + JSON.stringify(roundTrip));
  // A very tall card and a long conversation: the window should grow and the chat box stay in view.
  w.show(); await new Promise((r) => setTimeout(r, 300));
  const before = w.getBounds().height;
  await w.webContents.executeJavaScript(`(() => {
    const c = document.createElement('article'); c.className = 'card'; c.style.height = '420px'; c.textContent = 'tall card';
    document.getElementById('cards').append(c);
    const box = document.getElementById('log').firstElementChild;
    for (let i = 0; i < 40; i++) { const m = document.createElement('div'); m.className = 'msg msg-claude'; m.textContent = 'line ' + i; box.append(m); }
  })()`);
  await new Promise((r) => setTimeout(r, 600));
  const fit = await w.webContents.executeJavaScript(`({
    composerBottom: Math.round(document.getElementById('composer').getBoundingClientRect().bottom),
    viewport: window.innerHeight,
    barTop: Math.round(document.querySelector('.bar').getBoundingClientRect().top),
  })`);
  console.log('SMOKE-FIT ' + JSON.stringify({ before, after: w.getBounds().height, ...fit }));
  // Reading back: a wheel turn scrolls up, a new message then doesn't yank you down, and the window
  // stops resizing once it has the size it wants.
  const look = () => w.webContents.executeJavaScript(`(() => { const l = document.getElementById('log'); const r = l.getBoundingClientRect();
    return { top: Math.round(l.scrollTop), max: l.scrollHeight - l.clientHeight, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
      jump: !document.querySelector('.jump').hidden }; })()`);
  await w.webContents.executeJavaScript(`document.querySelector('.cards').replaceChildren(); document.querySelector('#log .empty')?.remove()`);
  await w.webContents.executeJavaScript(`document.querySelector('.jump').click()`);
  await new Promise((r) => setTimeout(r, 300));
  const start = await look();
  w.focus();
  for (let i = 0; i < 4; i++) { w.webContents.sendInputEvent({ type: 'mouseWheel', x: start.x, y: start.y, deltaX: 0, deltaY: 200, canScroll: true }); await new Promise((r) => setTimeout(r, 80)); }
  await new Promise((r) => setTimeout(r, 400));
  await new Promise((r) => setTimeout(r, 300));
  const up = await look();
  // app.js's add() is private, so drive it the way the app does: through a Claude reply event.
  w.webContents.send('event', { type: 'text', project: (await w.webContents.executeJavaScript(`document.getElementById('project').textContent`)), text: ' more' });
  await new Promise((r) => setTimeout(r, 300));
  const afterNew = await look();
  await w.webContents.executeJavaScript(`document.querySelector('.jump').click()`);
  w.webContents.send('event', { type: 'text', project: (await w.webContents.executeJavaScript(`document.getElementById('project').textContent`)), text: ' and more lines\n'.repeat(8) });
  await new Promise((r) => setTimeout(r, 300));
  const follow = await look();
  let resizes = 0; const count = () => { resizes += 1; }; w.on('resize', count);
  await new Promise((r) => setTimeout(r, 1500));
  w.off('resize', count);
  console.log('SMOKE-SCROLL ' + JSON.stringify({ startAtBottom: start.max - start.top <= 40, scrolledUpBy: start.top - up.top,
    stayedUp: Math.abs(afterNew.top - up.top) <= 2, jumpShown: afterNew.jump, followsAtBottom: follow.max - follow.top <= 40 && !follow.jump, idleResizes: resizes }));
  // Milestone 2: a delete card, a change card and a typo hint, the way the helper sends them.
  const project = await w.webContents.executeJavaScript(`document.getElementById('project').textContent`);
  const say = (ev) => w.webContents.send('event', { project, ...ev });
  say({ type: 'hint', kind: 'slash-typo', suggestion: 'design-rules', text: "There's no /desgin-rules in this project. Did you mean /design-rules?" });
  say({ type: 'change', id: 'toolu_smoke', file: 'notes.txt', sentence: 'Changed 1 line in notes.txt. Why: notes.txt has a typo.', canUndo: true,
    diff: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-teh notes', '+the notes'] }] });
  say({ type: 'approval', card: { id: 'smoke-card', toolName: 'Bash', danger: true, trash: true, defaultChoice: 'deny', command: 'git pull && rm old-notes.txt', learn: learnFor('Bash', {}, true),
    items: [{ say: 'Download the latest changes', target: '', danger: false }, { say: 'DELETE files', target: 'old-notes.txt', danger: true }] } });
  await new Promise((r) => setTimeout(r, 400));
  const card = await w.webContents.executeJavaScript(`(() => { const c = document.querySelector('.card'); return {
    red: c.classList.contains('danger'), ask: c.querySelector('.card-ask').textContent, steps: [...c.querySelectorAll('.card-steps li')].map((l) => l.textContent),
    buttons: [...c.querySelectorAll('.card-actions button')].map((b) => [b.textContent, b.className]), focusedInCard: c.contains(document.activeElement),
    change: document.querySelector('.change summary')?.textContent, undo: document.querySelector('.change button')?.textContent,
    fix: [...document.querySelectorAll('.line-hint button')].map((b) => b.textContent),
    learn: c.querySelector('.card-learn-line')?.textContent, learnButtons: [...c.querySelectorAll('.card-learn button')].map((b) => b.textContent) }; })()`);
  console.log('SMOKE-CARD ' + JSON.stringify(card));
  // Milestone 3: a reply's next steps become buttons, and opening the window puts the cursor in the chat box.
  say({ type: 'text', text: 'I fixed the typo.\n' }); say({ type: 'suggestions', items: ['Run the tests', 'Show me what changed'] });
  say({ type: 'opened', ms: 40, source: 'icon' });
  await new Promise((r) => setTimeout(r, 300));
  console.log('SMOKE-NEXT ' + JSON.stringify(await w.webContents.executeJavaScript(`({
    buttons: [...document.querySelectorAll('.next button')].map((b) => b.textContent), group: document.querySelector('.next')?.getAttribute('aria-label'),
    cursorInChatBox: document.activeElement?.id === 'input' })`)));
  // Keyboard: Tab from the top reaches every control, in order, and each shows a focus ring.
  await w.webContents.executeJavaScript(`document.activeElement?.blur(); document.body.focus()`);
  const walk = [];
  for (let i = 0; i < 20; i++) {
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await new Promise((r) => setTimeout(r, 60));
    walk.push(await w.webContents.executeJavaScript(`(() => { const a = document.activeElement; if (!a || a === document.body) return null;
      const name = (a.id ? '#' + a.id : a.tagName.toLowerCase()) + (a.tagName === 'BUTTON' || a.tagName === 'SUMMARY' ? ':' + a.textContent.trim().slice(0, 22) : '');
      return { name, ring: getComputedStyle(a).outlineStyle !== 'none' && a.matches(':focus-visible') }; })()`));
  }
  const reach = await w.webContents.executeJavaScript(`[...document.querySelectorAll('button, select, textarea, summary, [tabindex="0"]')]
    .filter((n) => !n.disabled && n.offsetParent !== null && !n.closest('details:not([open]) > :not(summary)')).map((a) => (a.id ? '#' + a.id : a.tagName.toLowerCase()) + (a.tagName === 'BUTTON' || a.tagName === 'SUMMARY' ? ':' + a.textContent.trim().slice(0, 22) : ''))`);
  const tabbed = [...new Set(walk.filter(Boolean).map((x) => x.name))];
  console.log('SMOKE-TAB ' + JSON.stringify({ controls: reach.length, reached: tabbed.length, missed: reach.filter((n) => !tabbed.includes(n)), allRinged: walk.filter(Boolean).every((x) => x.ring), order: tabbed }));
  // Milestone 4: the Projects panel (projects with tags, past chats, the safety section) and the Usage panel.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await w.webContents.executeJavaScript(`document.getElementById('project').click()`); await wait(500);
  const panel = await w.webContents.executeJavaScript(`({ open: !document.getElementById('panel-projects').hidden,
    expanded: document.getElementById('project').getAttribute('aria-expanded'),
    projects: [...document.querySelectorAll('.project-item')].map((b) => b.textContent), current: document.querySelector('.project-item[aria-current]')?.textContent,
    chats: document.querySelector('.chat-list')?.textContent, safety: [...document.querySelectorAll('#panel-projects .panel-section:last-child p')].map((p) => p.textContent),
    buttons: [...document.querySelectorAll('#panel-projects button')].map((b) => b.textContent.slice(0, 24)) })`);
  if (process.env.SMOKE_SHOT) { const fs = await import('node:fs'); fs.writeFileSync(process.env.SMOKE_SHOT.replace(/\.png$/, '-panel.png'), (await w.webContents.capturePage()).toPNG()); }
  await w.webContents.executeJavaScript(`[...document.querySelectorAll('.project-item')].find((b) => b.textContent.startsWith('work-demo'))?.click()`); await wait(200);
  await w.webContents.executeJavaScript(`document.getElementById('project').click()`); await wait(500);
  panel.work = await w.webContents.executeJavaScript(`({ tag: document.getElementById('tag').textContent,
    safety: [...document.querySelectorAll('#panel-projects .panel-section:last-child p')].map((p) => p.textContent),
    buttons: [...document.querySelectorAll('#panel-projects .panel-section:last-child button')].map((b) => b.textContent) })`);
  const fits = await w.webContents.executeJavaScript(`Math.round(document.getElementById('composer').getBoundingClientRect().bottom) <= window.innerHeight`);
  panel.composerInView = fits;
  w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await wait(200);
  const escClosed = await w.webContents.executeJavaScript(`document.getElementById('panel-projects').hidden && document.activeElement?.id === 'project'`);
  await w.webContents.executeJavaScript(`document.getElementById('spend').click()`); await wait(300);
  const usage = await w.webContents.executeJavaScript(`[...document.querySelectorAll('#panel-usage p')].map((p) => p.textContent)`);
  const learnTitles = await w.webContents.executeJavaScript(`[...document.querySelectorAll('#panel-usage .panel-title')].map((h) => h.textContent)`);
  if (process.env.SMOKE_SHOT) { const fs = await import('node:fs'); fs.writeFileSync(process.env.SMOKE_SHOT.replace(/\.png$/, '-usage.png'), (await w.webContents.capturePage()).toPNG()); }
  await w.webContents.executeJavaScript(`document.getElementById('spend').click()`); await wait(200);
  console.log('SMOKE-PANEL ' + JSON.stringify({ ...panel, escClosed, usage, bars: await w.webContents.executeJavaScript(`document.querySelectorAll('progress').length`) }));
  // Milestone 5: starters in an empty chat fill the box (and send nothing); Usage has a Learning part; Wrap up asks first.
  const starters = await w.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('#log .starters button')];
    const sent = document.querySelectorAll('.msg-you').length; b[0]?.click();
    return { count: b.length, filled: document.getElementById('input').value, focused: document.activeElement?.id === 'input', sentNothing: document.querySelectorAll('.msg-you').length === sent }; })()`);
  await w.webContents.executeJavaScript(`document.getElementById('input').value = ''; document.getElementById('project').click()`); await wait(400);
  const wrap = await w.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('#panel-projects button')].find((x) => x.textContent === 'Wrap up this chat');
    b?.click(); const q = document.querySelector('#panel-projects .confirm'); return { button: !!b, asks: q?.querySelector('p')?.textContent, answers: [...(q?.querySelectorAll('button') || [])].map((x) => x.textContent) }; })()`);
  await w.webContents.executeJavaScript(`document.getElementById('project').click()`); await wait(200);
  console.log('SMOKE-LEARN ' + JSON.stringify({ starters, learnTitles, wrap }));
  if (process.env.SMOKE_SHOT) {
    const fs = await import('node:fs');
    w.show(); await w.webContents.executeJavaScript(`document.activeElement?.blur(); document.querySelector('.log').scrollTop = 1e9`);
    await new Promise((r) => setTimeout(r, 500));
    fs.writeFileSync(process.env.SMOKE_SHOT, (await w.webContents.capturePage()).toPNG());
    await w.webContents.executeJavaScript(`document.documentElement.dataset.theme = 'dark'`);
    await new Promise((r) => setTimeout(r, 400));
    fs.writeFileSync(process.env.SMOKE_SHOT.replace(/\.png$/, '-dark.png'), (await w.webContents.capturePage()).toPNG());
  }
  app.quit();
}, 3000));
