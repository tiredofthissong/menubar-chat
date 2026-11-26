// devmode.mjs - Dev mode (Bromo, Nov 26: "the allow prompts are too many, there should be a dev
// mode that allows most actions unless they go to root files or outside of the project folder").
// Claude goes ahead without a card only when the step stays inside this project folder:
//   - reading, listing and searching in the folder
//   - changing or creating a file in the folder (not inside .git); Undo still works
//   - a command whose every step stays in the folder and is not one of the kinds below
// It still asks for: anything outside the folder or in your home or system folders, deletes,
// the internet (downloads, installs, git push and pull), connected apps, helpers, sudo and
// system tools, and git steps that throw work away. The hard rules (push block, secret files,
// the personal hub) run before this and are never loosened. Pure apart from reading real paths.
import fs from 'node:fs';
import path from 'node:path';
import { commandEffect } from '../shared/describe.mjs';
import { splitSteps } from '../shared/explain.mjs';
import { stripHeredocs, pathView, sedReachesOut, MATHS } from '../shared/shell.mjs';

const READS = new Set(['Read', 'Glob', 'Grep', 'TodoWrite', 'BashOutput']);
const EDITS = { Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' };

// A path as the disk sees it, so a link inside the folder that points outside counts as outside.
function real(p) {
  const rest = [];
  for (let cur = p; ;) {
    try { return path.join(fs.realpathSync(cur), ...rest.reverse()); } catch { /* not there yet */ }
    const up = path.dirname(cur); if (up === cur) return p;
    rest.push(path.basename(cur)); cur = up;
  }
}

/** Is this path inside the project folder? The folder itself counts only when `self` is true. */
export function insideProject(file, root, { self = false } = {}) {
  if (typeof file !== 'string' || !file || file.startsWith('~') || typeof root !== 'string' || !root) return false;
  const rel = path.relative(real(path.resolve(root)), real(path.resolve(root, file)));
  if (rel === '') return self;
  return !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.split(path.sep).includes('.git');
}

// Words that always ask, wherever they point. Matched as whole words, outside quoted text, so
// `echo "=== open questions ==="` doesn't ask (Bromo's test, Nov 26). Words that run another
// command (env, nohup, timeout...) ask too, since the command they run may be in quotes.
const ASK_WORD = /(^|[\s;|&(])(sudo|su|doas|eval|exec|source|xargs|env|nohup|nice|timeout|watch|command|builtin|caffeinate|osascript|open|launchctl|defaults|kill|killall|pkill|shutdown|reboot|crontab|chown|chgrp|dd|mkfs|diskutil|truncate|shred|brew|curl|wget|ssh|scp|rsync|nc|security|networksetup|softwareupdate|ln)(?=$|[\s;|&)])/;
const RISKY_GIT = /\bgit\s+(-C\s+\S+\s+)?(push|pull|fetch|clone|reset|clean|restore|rebase|checkout\s+(--|\.)|switch\s+-[cC]|stash\s+(drop|clear)|branch\s+-[dD]|filter-branch|remote|config|gc|prune|submodule|worktree)\b/;
const RISKY_SHAPES = [/\$\(/, /`/, /\|\s*(sh|bash|zsh)\b/, /\|\s*(node|python3?|ruby|perl)\s*($|[;&|])/, /\b(sh|bash|zsh)\s+-\w*c\b/, /(^|\s)--?g(lobal)?\b/, /\bfind\b[^;&|]*\s-(delete|exec|execdir|ok)\b/, /(^|[\s'"=:/])\.\.(\/|\s|$|['"])/, /(^|[\s=:])~/, /\$\{?HOME\b/];

// Code typed into the command (python3 -c "...", node -e "...") that deletes, runs other programs
// or reaches the internet asks, even though the words are in quotes.
const INLINE_CODE = /\b(python3?|node|ruby|perl)\s+(-\S+\s+)*-(c|e|p)\b/;
const CODE_DANGER = /\b(system|popen|subprocess|child_process|spawn|exec\w*|unlink\w*|remove|rmdir|rmtree|rmSync|rm|urlopen|urllib|requests|fetch|https?|socket|import\s*\()\b/;
// Quoted text with the quotes' contents taken out, or null when quotes or backslashes could hide
// a command's name ("sudo" ls, su\do ls run sudo): then the command asks.
function outsideQuotes(cmd) {
  let out = ''; let q = null;
  // Where a command name goes: the start, or after ; | & ( once any NAME=value words are past.
  const atCommand = () => /^(\s*\w+=\S*)*\s*$/.test(out.split(/[;|&(]/).at(-1));
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) { if (ch === q) { q = null; out += '""'; } else if (q === '"' && ch === '\\') i++; continue; }
    if (ch === '"' || ch === "'") { if (atCommand() || cmd[i - 1] === '$') return null; q = ch; continue; } // a quoted command name, or $'...'
    if (ch === '\\') return null; // su\do runs sudo
    out += ch;
  }
  return q ? null : out;
}

// `for f in $(find . -name "*.js"); do ...` (Bromo's prompt 2, Nov 26): a $(...) inside a command
// goes ahead only when what's inside only looks and stays in the folder. Nested ones, backticks
// and anything else still ask. Returns the command with each such $(...) swapped for a word.
function lookingSubstitutions(cmd, root) {
  let out = cmd;
  for (let i = 0; i < 5 && /\$\(/.test(out); i++) {
    const m = /\$\(([^()`$]*)\)/.exec(out);
    if (!m) return null;
    const inner = m[1];
    if (commandEffect(splitSteps(inner), false) !== 'looks' || !commandStaysIn(inner, root, 'looks')) return null;
    out = out.slice(0, m.index) + 'FOUND' + out.slice(m.index + m[0].length);
  }
  return /\$\(/.test(out) ? null : out;
}

/** Does a command stay in the project folder, with nothing on the always-ask list? */
export function commandStaysIn(command, root, effect) {
  if (effect !== 'looks' && effect !== 'runs') return false; // deletes, the internet and the unknown ask
  // File text written with <<'EOF' is used exactly as typed, so only the command around it counts.
  // Without quotes (<<EOF) the shell would run any $(...) or `...` in it, so those ask.
  const { command: bare, bodies } = stripHeredocs(command);
  if (bodies.some((b) => !b.quoted && /\$\(|`/.test(b.body)) || sedReachesOut(bare)) return false;
  if (/<</.test(String(command)) && MATHS.test(String(command))) return false; // maths next to file text: ask
  const cmd = lookingSubstitutions(bare, root);
  if (cmd === null) return false;
  const words = outsideQuotes(cmd);
  if (!cmd.trim() || words === null || ASK_WORD.test(words) || RISKY_GIT.test(words) || RISKY_SHAPES.some((re) => re.test(cmd))) return false;
  if (INLINE_CODE.test(words) && CODE_DANGER.test(cmd)) return false;
  return !pointsOutside(cmd, root);
}

/** Does a command name a place outside the project folder (.., ~, $HOME, or a path elsewhere)? */
export function pointsOutside(command, root) {
  const cmd = pathView(stripHeredocs(command).command); // not quoted page text like '<h1>…</h1>'
  if (/(^|[\s'"=:/])\.\.(\/|\s|$|['"])/.test(cmd) || /(^|[\s=:])~/.test(cmd) || /\$\{?(HOME|PWD|OLDPWD)\b/.test(cmd)) return true;
  const paths = cmd.match(/(?:^|[\s=:<>'"(])(\/[^\s'";|&<>)]*)/g) || [];
  return !paths.map((m) => m.replace(/^[\s=:<>'"(]/, '')).every((p) => p === '/dev/null' || insideProject(p, root, { self: true }));
}

/** Should Dev mode go ahead without a card? `card` is explainToolCall's result for this call. */
export function devModeAllows(toolName, input = {}, root, card = {}) {
  const i = input || {};
  if (READS.has(toolName)) {
    const where = i.file_path ?? i.path;
    return where === undefined || where === '' || insideProject(where, root, { self: true });
  }
  if (Object.hasOwn(EDITS, toolName)) return insideProject(i[EDITS[toolName]], root);
  if (toolName === 'Bash') return card.danger !== true && commandStaysIn(i.command, root, card.effect);
  return false; // the web, connected apps, helpers, skills, plans and anything new: Claude asks
}

/** Does this step only read or search inside the project folder? (Nothing from the web or elsewhere.) */
export function looksInside(toolName, input = {}, root) {
  const i = input || {};
  if (['TodoWrite', 'AskUserQuestion', 'ExitPlanMode'].includes(toolName)) return true; // asking you isn't reading elsewhere
  if (READS.has(toolName)) return !looksOutside(toolName, i, root);
  return toolName === 'Bash' && commandEffect(splitSteps(i.command), false) === 'looks' && commandStaysIn(i.command, root, 'looks');
}

/**
 * Does this step only look, but somewhere outside the project folder? Claude Code lets its own
 * list of read-only commands (ls, cat, find...) run without asking anyone, wherever they point,
 * so `ls ..` ran with no card (Bromo's test, Nov 26). The app's hook asks you about these itself,
 * in every mode.
 */
export function looksOutside(toolName, input = {}, root, card = {}) {
  const i = input || {};
  if (READS.has(toolName)) {
    const where = [i.file_path, i.path].filter((p) => typeof p === 'string' && p !== '');
    if (toolName === 'Glob' && /^[/~]/.test(String(i.pattern ?? ''))) where.push(String(i.pattern).replace(/[*?[{].*$/, '') || '/');
    return where.some((p) => !insideProject(p, root, { self: true }));
  }
  return toolName === 'Bash' && card.effect === 'looks' && !commandStaysIn(i.command, root, 'looks');
}
