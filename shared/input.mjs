// input.mjs - what you typed, sorted before anything reaches Claude. The app has no shell box,
// so typing /design-rules into the Terminal can't happen here. What can happen: a pasted Terminal
// line, "claude /x", "!cmd", a mistyped /command, or a Terminal-only one. Each gets one calm line;
// none adds a step. Pure: no I/O. Idea from this project's ease-of-use prototype, rewritten small.
import { redact } from './redact.mjs';

const SHELL_WORDS = new Set(['git', 'cd', 'mkdir', 'cp', 'mv', 'rm', 'ls', 'npm', 'npx', 'pip', 'pip3', 'python', 'python3',
  'node', 'brew', 'curl', 'wget', 'chmod', 'touch', 'cat', 'echo', 'gh', 'open', 'pwd', 'head', 'tail', 'grep']);
const ENGLISH = /\b(the|my|and|please|can|could|you|me|a|an|this|that|what|why|how|for|with|latest|is|it)\b/i;

// Claude Code commands this window does itself, or doesn't need.
export const APP_NATIVE = {
  clear: { action: 'newChat', note: 'Started a fresh chat. Your earlier chat is kept in Claude Code\'s history.' },
  resume: { note: 'Past chats come back with the project sidebar. For now, keep going in this chat.' },
  usage: { note: 'Today\'s spend is always shown at the top right of this window.' },
  cost: { note: 'Today\'s spend is always shown at the top right of this window. Hover it for this chat\'s cost.' },
  context: { note: 'Hover the spend at the top right to see how much of this chat\'s memory is used.' },
  permissions: { note: 'How much Claude may do on its own is the Ask me first button at the top.' },
  model: { note: 'This app uses Sonnet, set for the whole app.' },
  login: { note: 'This app uses its own API key, so there is nothing to sign in to here.' },
  logout: { note: 'This app uses its own API key, so there is nothing to sign out of here.' },
  exit: { note: 'Press Esc to tuck the window away. Claude keeps working in the background.' },
};
const TERMINAL_ONLY = ['theme', 'terminal-setup', 'vim', 'statusline', 'ide', 'doctor', 'config', 'keybindings'];

export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

const words = (line) => line.match(/"[^"]*"|'[^']*'|\S+/g) || [];

/** A line that reads like a Terminal command, not a request in words. */
export function looksLikeShell(line) {
  const w = words(line.trim());
  if (!w.length || !SHELL_WORDS.has(w[0])) return false;
  if (/&&|\|\||;|\s-{1,2}[a-z]/i.test(line) || /[~/]|\.\w/.test(line)) return true;
  if (ENGLISH.test(line) || /\?$/.test(line)) return false;
  return w.length <= 3;
}

/**
 * @param {string} text
 * @param {{ commands?: string[]|null, project?: string }} ctx  commands: the project's slash commands,
 *   or null before Claude Code has said which ones exist (then a /command is sent as typed).
 * @returns {{ kind: string, send: string|null, note: string, action?: string, suggestion?: string }}
 *   send: what goes to Claude (null: nothing is sent, and the note says why).
 */
export function classifyInput(text, { commands = null, project = 'this project' } = {}) {
  let t = String(text ?? '').trim();
  let pre = '';
  if (/^claude(\s|$)/i.test(t)) {
    t = t.replace(/^claude\s*/i, '').replace(/^["']|["']$/g, '').trim();
    pre = 'No need to type "claude" here: this box already talks to Claude.';
  }
  if (/^(!|\$\s)/.test(t)) { t = t.replace(/^(!|\$\s)\s*/, ''); pre = 'No "!" or "$" needed here.'; }
  const say = (...parts) => [pre, ...parts].filter(Boolean).join(' ');
  if (!t) return { kind: 'empty', send: null, note: say() };

  if (t.startsWith('/') && !/^\/(Users|tmp|var|etc|opt|private|Volumes)\//.test(t)) {
    const name = t.slice(1).split(/\s/)[0].toLowerCase();
    if (Array.isArray(commands) && commands.includes(name)) return { kind: 'slash', send: t, note: say() };
    if (Object.hasOwn(APP_NATIVE, name)) return { kind: 'slash-app', send: null, action: APP_NATIVE[name].action, note: say(`/${name}: ${APP_NATIVE[name].note}`) };
    if (TERMINAL_ONLY.includes(name)) return { kind: 'slash-terminal', send: null, note: say(`/${name} only works in the Terminal version of Claude Code. Nothing to do here.`) };
    if (!Array.isArray(commands)) return { kind: 'slash', send: t, note: say() }; // not known yet: Claude Code decides
    const near = commands.map((c) => [c, editDistance(name, c)]).filter(([, d]) => d <= 2).sort((a, b) => a[1] - b[1])[0];
    if (near) return { kind: 'slash-typo', send: null, suggestion: near[0], note: say(`There's no /${name} in ${project}. Did you mean /${near[0]}?`) };
    const some = commands.slice(0, 6).map((c) => `/${c}`).join(', ');
    return { kind: 'slash-unknown', send: null, note: say(`There's no /${name} in ${project}, so nothing was sent.${some ? ` Some that are: ${some}.` : ''}`) };
  }

  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length && lines.length <= 20 && lines.every(looksLikeShell)) {
    const command = lines.join(' && ');
    return {
      kind: 'shell', command: redact(command),
      note: say('That\'s a Terminal command. No Terminal needed: Claude will show you every step and run it after you allow it.'),
      send: `Run exactly this as one command, then tell me in one sentence what happened:\n\`\`\`\n${command}\n\`\`\``,
    };
  }
  return { kind: 'prompt', send: t, note: say() };
}
