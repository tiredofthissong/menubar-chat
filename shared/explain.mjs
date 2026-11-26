// explain.mjs - one plain line for each approval card, plus every step of a chained command.
// Rule from the research (Caprock finding): a chain's explanation must name EVERY step,
// so a hidden step (like the cp in git pull && mkdir && cp) can't slip past unread.
import path from 'node:path';
import { redact } from './redact.mjs';
import { describeTool, commandEffect, EFFECTS } from './describe.mjs';

const GLOSS = [
  [/^git\s+pull\b/, 'download the latest changes'],
  [/^git\s+push\b/, 'upload your commits to the remote'],
  [/^git\s+clone\b/, 'copy a repository'],
  [/^git\s+commit\b/, 'save a snapshot of your changes'],
  [/^git\s+add\b/, 'mark files to include in the next snapshot'],
  [/^git\s+status\b/, 'show what changed'],
  [/^git\b/, 'run a git command'],
  [/^mkdir\b/, 'make a folder'],
  [/^cp\b/, 'copy files'],
  [/^mv\b/, 'move or rename files'],
  [/^rm\b/, 'DELETE files'],
  [/^(ls|pwd)\b/, 'list files'],
  [/^cat\b/, 'show a file'],
  [/^cd\b/, 'go into a folder'],
  [/^(npm|npx)\s+(install|i)\b/, 'install packages'],
  [/^(npm|npx)\b/, 'run a Node tool'],
  [/^(python3?|node)\b/, 'run a script'],
  [/^(curl|wget)\b/, 'download from the internet'],
  [/^chmod\b/, 'change file permissions'],
  [/^for\b/, 'repeat for each item'],
  [/^(while|until)\b/, 'repeat while a check holds'],
  [/^(if|elif)\b/, 'check a condition'],
  [/^case\b/, 'pick a branch'],
  [/^(test|\[\[?)\s/, 'check a condition'],
  [/^(echo|printf)\b/, 'print text'],
  [/^(grep|rg)\b/, 'search inside files'],
  [/^(find)\b/, 'look for files'],
  [/^(head|tail|wc|sort)\b/, 'look at part of a file'],
  [/^touch\b/, 'create an empty file'],
];

/** Split a shell command into its steps (display-grade, not a full shell parser). */
// Shell words that only open or close a block. "do echo x" is the step "echo x"; a bare
// "done" or "fi" is not a step at all.
const BLOCK_OPENER = /^(do|then|else|\{|\()\s+/;
const BLOCK_ONLY = /^(do|done|then|else|fi|esac|\{|\}|\(|\))(\s*[<>].*)?$/;

export function splitSteps(command) {
  return String(command).split(/\s*(?:&&|\|\||;|\n)\s*/)
    .map((s) => { let t = s.trim(); while (BLOCK_OPENER.test(t)) t = t.replace(BLOCK_OPENER, ''); return t; })
    .filter((s) => s && !BLOCK_ONLY.test(s));
}

export function glossStep(step) {
  const bare = step.replace(/^(\w+=\S+\s+)+/, '');
  for (const [re, words] of GLOSS) if (re.test(bare)) return words;
  return `run "${bare.split(/\s+/)[0]}"`;
}

// The file or folder a step works on, so "Make a folder" can say which one. File commands only;
// anything else shows no target (the exact command is still one click away on the card).
const TARGETED = /^(mkdir|cp|mv|rm|touch|cat|cd|ls|chmod|head|tail)$/;
const unquote = (w) => w.replace(/^(['"])(.*)\1$/, '$2');
export function stepTarget(step) {
  const words = (step.replace(/^(sudo\s+)?(\w+=\S+\s+)*/, '').match(/"[^"]*"|'[^']*'|\S+/g) || []);
  const [cmd, ...rest] = words;
  if (!cmd || !TARGETED.test(cmd)) return '';
  const stop = rest.findIndex((w) => /^\d?[<>|&]/.test(w)); // a redirect like > out.txt isn't the target
  let args = (stop < 0 ? rest : rest.slice(0, stop)).filter((w) => !/^-/.test(w)).map(unquote);
  if (cmd === 'chmod') args = args.slice(1); // the first word is the permission, not a file
  if (!args.length) return '';
  const text = (cmd === 'cp' || cmd === 'mv') && args.length >= 2
    ? `${args.slice(0, -1).join(', ')} → ${args.at(-1)}`
    : args.join(', ');
  return redact(text.length > 70 ? `${text.slice(0, 69)}…` : text);
}
const sentence = (words) => words.charAt(0).toUpperCase() + words.slice(1);

const short = (p, cwd) => { const r = path.relative(cwd || '/', String(p || '')); return r && !r.startsWith('..') ? r : String(p || ''); };

/**
 * Every card also carries describe.mjs's fixed shape: what, effect, where, reason.
 * @returns {{ plain: string, what: string, effect: string, where: string, reason: string, steps: string[], items?: {say: string, target: string, danger: boolean}[], command?: string, danger: boolean }}
 */
export function explainToolCall(toolName, input = {}, cwd = '/') {
  if (toolName === 'Bash') {
    const steps = splitSteps(input.command);
    const glossed = steps.map(glossStep);
    const danger = steps.some((s) => /^(sudo\s+)?rm\b/.test(s.replace(/^(\w+=\S+\s+)+/, '')));
    const plain = steps.length > 1 ? `Run ${steps.length} steps: ${glossed.join('; ')}.` : `Run a command to ${glossed[0] || 'do something'}.`;
    // items: each step in plain words for the card, with the file it touches (if any).
    const items = steps.map((st, n) => ({ say: sentence(glossed[n]), target: stepTarget(st), danger: /^(sudo\s+)?rm\b/.test(st.replace(/^(\w+=\S+\s+)+/, '')) }));
    const what = steps.length > 1 ? `run ${steps.length} commands, in this order` : `run a command to ${glossed[0] || 'do something'}`;
    const reason = redact(String(input.description || '').replace(/\s+/g, ' ').trim()).slice(0, 160);
    const effect = commandEffect(steps, danger);
    return { plain, what, effect, kindLabel: EFFECTS[effect], where: steps.length === 1 ? items[0].target : '', reason, steps: steps.map(redact), items, command: redact(input.command), danger };
  }
  const shape = describeTool(toolName, input, cwd);
  const base = { ...shape, kindLabel: EFFECTS[shape.effect], steps: [], danger: false };
  if (toolName === 'Edit' || toolName === 'MultiEdit') return { ...base, plain: `Change ${short(input.file_path, cwd)}.` };
  if (toolName === 'Write') return { ...base, plain: `Create or replace ${short(input.file_path, cwd)} (replacing a whole file is harder to undo).` };
  if (toolName === 'ExitPlanMode') return { ...base, plain: 'The plan is ready. Start on it? Claude still asks before each change.' };
  return { ...base, plain: `${sentence(shape.what)}.` };
}
