// describe.mjs - every approval card in one shape (Bromo, Nov 26: cards listed each action by its
// tool name but didn't say clearly what was asked and why, the same way every time):
//   what   finishes "Claude wants to …", in plain words, never a bare tool name if we know the tool
//   effect what kind of step it is, from one fixed list, so cards read alike at a glance
//   where  the file, folder, site or app it touches ('' if none)
//   reason Claude's own words from the tool call, when the tool carries them (a command's
//          description, a helper's task); the session adds the "Why:" line Claude wrote first.
import path from 'node:path';
import { redact } from './redact.mjs';

/** The fixed list. Order is from most to least careful. */
export const EFFECTS = {
  deletes: 'Deletes files',
  internet: 'Uses the internet',
  app: 'Uses a connected app',
  changes: 'Changes files',
  runs: 'Runs a program',
  looks: 'Only looks',
  plan: 'Still asks before each change',
};

const clip = (s, n = 70) => { const t = redact(String(s ?? '').replace(/\s+/g, ' ').trim()); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const rel = (p, cwd) => { const r = path.relative(cwd || '/', String(p || '')); return clip(r && !r.startsWith('..') ? r : String(p || '')); };
const host = (u) => { try { return new URL(String(u)).hostname; } catch { return ''; } };

// Commands that only look, and ones that reach the internet. Anything else counts as running a program.
const LOOKS = /^(ls|pwd|cat|head|tail|wc|sort|grep|rg|find|echo|printf|which|file|stat|du|df|tree|diff|test|\[\[?|git\s+(status|log|diff|show|branch|remote)\b|(npm|node|python3?)\s+(-v|--version)\b|(for|while|until|if|elif|case|cd)\b)/;
const NET = /^(curl|wget|ssh|scp|rsync|gh\b|git\s+(pull|push|fetch|clone)\b|(npm|npx|pnpm|yarn)\s+(install|i|ci|add|publish)\b|pip3?\s+install\b|brew\s+(install|upgrade)\b)/;
const bare = (s) => s.replace(/^(sudo\s+)?(\w+=\S+\s+)*/, '');
export function commandEffect(steps, danger) {
  if (danger) return 'deletes';
  const s = steps.map(bare);
  if (s.some((x) => NET.test(x))) return 'internet';
  if (s.length && s.every((x) => LOOKS.test(x) && !/\s>{1,2}\s*\S/.test(x))) return 'looks';
  return 'runs';
}

/** @returns {{ what: string, effect: keyof EFFECTS, where: string, reason: string }} */
export function describeTool(toolName, input = {}, cwd = '/') {
  const i = input || {};
  const d = (what, effect, where = '', reason = '') => ({ what, effect, where, reason: clip(reason, 160) });
  switch (toolName) {
    case 'Edit': case 'MultiEdit': return d(`change ${rel(i.file_path, cwd)}`, 'changes', rel(i.file_path, cwd));
    case 'Write': return d(`create or replace ${rel(i.file_path, cwd)}`, 'changes', rel(i.file_path, cwd));
    case 'NotebookEdit': return d(`change the notebook ${rel(i.notebook_path, cwd)}`, 'changes', rel(i.notebook_path, cwd));
    case 'Read': return d(`read ${rel(i.file_path, cwd)}`, 'looks', rel(i.file_path, cwd));
    case 'Glob': return d(`list files that match ${clip(i.pattern, 40)}`, 'looks', i.path ? rel(i.path, cwd) : '');
    case 'Grep': return d(`search files for "${clip(i.pattern, 40)}"`, 'looks', i.path ? rel(i.path, cwd) : '');
    case 'WebFetch': return d(`open a web page on ${host(i.url) || 'the internet'}`, 'internet', host(i.url), i.prompt);
    case 'WebSearch': return d(`search the web for "${clip(i.query, 50)}"`, 'internet');
    case 'Agent': case 'Task': return d('hand part of this job to a helper Claude', 'runs', '', i.description || i.prompt);
    case 'Skill': return d(`use the ${clip(i.skill || i.command || 'named', 30)} skill`, 'runs');
    case 'TodoWrite': return d('update its to-do list for this job', 'looks');
    case 'BashOutput': return d('check on a command it started', 'looks');
    case 'KillShell': case 'KillBash': return d('stop a command it started', 'runs');
    case 'ExitPlanMode': return d('start on the plan', 'plan');
    default: {
      const m = /^mcp__(.+?)__(.+)$/.exec(String(toolName));
      if (m) return d(`use "${clip(m[2].replace(/_/g, ' '), 40)}" in ${clip(m[1].replace(/_/g, ' '), 30)}`, 'app', clip(m[1].replace(/_/g, ' '), 30));
      return d(`use a tool called ${clip(toolName, 40)}, which this app doesn't know`, 'runs');
    }
  }
}
