// smoke-electron.mjs - DEVELOPER CHECK ONLY: starts the real app, reads what the window shows,
// prints it, and quits. Run: npx electron scripts/smoke-electron.mjs
import { app, BrowserWindow } from 'electron';
import '../app/main.mjs';

app.whenReady().then(() => setTimeout(async () => {
  const w = BrowserWindow.getAllWindows()[0];
  const seen = await w.webContents.executeJavaScript(`({
    projects: [...document.querySelectorAll('#project option')].map((o) => o.textContent),
    tag: document.getElementById('tag').textContent,
    checks: document.querySelectorAll('.check').length,
    tryButtons: [...document.querySelectorAll('.check button')].filter((b) => b.textContent === 'Try it').length,
    notice: document.getElementById('notice').hidden ? '' : document.getElementById('notice').textContent,
    spend: document.getElementById('spend').textContent,
  })`);
  console.log('SMOKE ' + JSON.stringify(seen));
  // The background helper: a command from the window goes through the app to the helper and back.
  const roundTrip = await w.webContents.executeJavaScript(`(async () => {
    const p = document.getElementById('project').value;
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
  w.webContents.send('event', { type: 'text', project: (await w.webContents.executeJavaScript(`document.getElementById('project').value`)), text: ' more' });
  await new Promise((r) => setTimeout(r, 300));
  const afterNew = await look();
  await w.webContents.executeJavaScript(`document.querySelector('.jump').click()`);
  w.webContents.send('event', { type: 'text', project: (await w.webContents.executeJavaScript(`document.getElementById('project').value`)), text: ' and more lines\n'.repeat(8) });
  await new Promise((r) => setTimeout(r, 300));
  const follow = await look();
  let resizes = 0; const count = () => { resizes += 1; }; w.on('resize', count);
  await new Promise((r) => setTimeout(r, 1500));
  w.off('resize', count);
  console.log('SMOKE-SCROLL ' + JSON.stringify({ startAtBottom: start.max - start.top <= 40, scrolledUpBy: start.top - up.top,
    stayedUp: Math.abs(afterNew.top - up.top) <= 2, jumpShown: afterNew.jump, followsAtBottom: follow.max - follow.top <= 40 && !follow.jump, idleResizes: resizes }));
  if (process.env.SMOKE_SHOT) {
    w.show(); await new Promise((r) => setTimeout(r, 800));
    const fs = await import('node:fs');
    fs.writeFileSync(process.env.SMOKE_SHOT, (await w.webContents.capturePage()).toPNG());
  }
  app.quit();
}, 3000));
