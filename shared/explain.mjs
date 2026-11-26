// explain.mjs - one plain line for each approval card, plus every step of a chained command.
// Rule from the research (Caprock finding): a chain's explanation must name EVERY step,
// so a hidden step (like the cp in git pull && mkdir && cp) can't slip past unread.
import path from 'node:path';
import { redact } from './redact.mjs';

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

const short = (p, cwd) => { const r = path.relative(cwd || '/', String(p || '')); return r && !r.startsWith('..') ? r : String(p || ''); };

/** @returns {{ plain: string, steps: string[], command?: string, danger: boolean }} */
export function explainToolCall(toolName, input = {}, cwd = '/') {
  if (toolName === 'Bash') {
    const steps = splitSteps(input.command);
    const glossed = steps.map(glossStep);
    const danger = steps.some((s) => /^(sudo\s+)?rm\b/.test(s.replace(/^(\w+=\S+\s+)+/, '')));
    const plain = steps.length > 1 ? `Run ${steps.length} steps: ${glossed.join('; ')}.` : `Run a command to ${glossed[0] || 'do something'}.`;
    return { plain, steps: steps.map(redact), command: redact(input.command), danger };
  }
  if (toolName === 'Edit' || toolName === 'MultiEdit') return { plain: `Change ${short(input.file_path, cwd)}.`, steps: [], danger: false };
  if (toolName === 'Write') return { plain: `Create or replace ${short(input.file_path, cwd)} (replacing a whole file is harder to undo).`, steps: [], danger: false };
  if (toolName === 'ExitPlanMode') return { plain: 'The plan is ready. Start on it? Claude still asks before each change.', steps: [], danger: false };
  if (toolName === 'Read') return { plain: `Read ${short(input.file_path, cwd)}.`, steps: [], danger: false };
  return { plain: `Use ${toolName}.`, steps: [], danger: false };
}
