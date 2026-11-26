// login-item.mjs - Start at login and Quit, on the menu bar icon's right-click menu.
// Start at login is off until you turn it on, and only the installed app offers it: run from the
// Terminal (npm start) it would add Electron itself to your login items, so it stays greyed out.
// Pure apart from what it's handed, so it's tested without Electron.

export const QUIT_LABEL = 'Quit Menu Bar Chat';

export function createLoginItem({ app, platform = process.platform }) {
  const available = () => app.isPackaged === true && platform === 'darwin';
  return {
    available,
    isOn: () => available() && app.getLoginItemSettings().openAtLogin === true,
    /** Your click on the menu is the only caller. */
    set(on) {
      if (!available() || typeof on !== 'boolean') return false;
      app.setLoginItemSettings({ openAtLogin: on });
      return true;
    },
  };
}

/** Built fresh on each right-click, so the tick always shows how it is right now. */
export function trayMenuTemplate({ login, quit }) {
  return [
    login.available()
      ? { label: 'Start at login', type: 'checkbox', checked: login.isOn(), click: (item) => login.set(item.checked === true) }
      : { label: 'Start at login (in the installed app)', type: 'checkbox', checked: false, enabled: false },
    { type: 'separator' },
    { label: QUIT_LABEL, click: () => quit() },
  ];
}

/** Commands run from the Finder get a short PATH; add the usual places for git, node and Homebrew. */
export function withCommonPaths(current, home) {
  const have = String(current || '').split(':').filter(Boolean);
  const usual = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', `${home}/.local/bin`, '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  return [...new Set([...have, ...usual])].join(':');
}
