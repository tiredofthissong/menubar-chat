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
  if (process.env.SMOKE_SHOT) {
    w.show(); await new Promise((r) => setTimeout(r, 800));
    const fs = await import('node:fs');
    fs.writeFileSync(process.env.SMOKE_SHOT, (await w.webContents.capturePage()).toPNG());
  }
  app.quit();
}, 3000));
