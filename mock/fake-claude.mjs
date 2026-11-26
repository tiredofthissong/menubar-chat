// fake-claude.mjs - TESTS ONLY. Stands in for the Claude Code binary so the REAL Agent SDK
// runs end to end with no API key, no network and no cost. Plugged in through the SDK's own
// Options.spawnClaudeCodeProcess; speaks the same newline-delimited JSON on stdin/stdout.
// Tool calls go through the documented order (code.claude.com/docs/en/agent-sdk/permissions):
//   1 PreToolUse hooks  2 deny rules  3 mode  4 allow rules  5 canUseTool
// Refactored from this project's code-health architect prototype. Never shipped in the app.
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const argValue = (args, name) => {
  const i = args.findIndex((a) => a === name || a.startsWith(name + '='));
  if (i < 0) return null;
  return args[i].includes('=') ? args[i].slice(name.length + 1) : args[i + 1];
};

/** Scenarios picked by a keyword in the prompt. allowRule = an allow rule in settings would skip the card. */
export const SCENARIOS = {
  chain: [{ say: 'I will update and copy the skill.\n' }, { tool: 'Bash', input: { command: 'git pull && mkdir -p .claude/skills/demo && cp kit/demo/SKILL.md .claude/skills/demo/' } }],
  edit: [{ say: 'Why: notes.txt has a typo.\n' }, { tool: 'Edit', input: { file_path: 'notes.txt', old_string: 'teh', new_string: 'the' } }],
  nowhy: [{ say: 'Fixing it.\n' }, { tool: 'Edit', input: { file_path: 'notes.txt', old_string: 'teh', new_string: 'the' } }],
  push: [{ tool: 'Bash', input: { command: 'git -C . push origin main' }, allowRule: true }],
  secret: [{ tool: 'Read', input: { file_path: '.env' } }],
  leak: [{ chunks: ['Your key is sk-ant-ab', 'cdef1234567890 ok\n'] }],
  hello: [{ say: 'Hello from the fake Claude.\n' }],
  plan: [{ say: 'Here is my plan.\n' }, { tool: 'ExitPlanMode', input: { plan: '1. Fix the typo in notes.txt' } }],
  sub: [{ say: 'Main line.\n' }, { say: 'Sub-agent chatter.\n', parent: 'toolu_parent' }],
  trash: [{ say: 'Cleaning up.\n' }, { tool: 'Bash', input: { command: 'rm old-notes.txt' } }],
  ask: [{ say: 'One question first.\n' }, { tool: 'AskUserQuestion', input: { questions: [{ question: 'Where does the plant info come from?', header: 'Data', multiSelect: false, options: [{ label: 'Typed in by hand', description: 'Fits in one day' }, { label: 'Sensors', description: 'Needs hardware' }] }] } }],
  next: [{ say: 'Done looking.\nNext: Run the tests\n' }, { say: '- **Next:** Fix the typo in notes.txt\nNext: Run the tests\n' }],
};
// Do an Edit for real (tests run in a temp folder) and report it the way Claude Code does.
function applyEdit(cwd, input) {
  const file = path.resolve(cwd, input.file_path);
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return { ok: false, why: 'File does not exist.' }; }
  const lines = text.split('\n'); const i = lines.findIndex((l) => l.includes(input.old_string));
  if (i < 0) return { ok: false, why: 'String to replace not found in file.' };
  const after = lines[i].replace(input.old_string, input.new_string);
  fs.writeFileSync(file, [...lines.slice(0, i), after, ...lines.slice(i + 1)].join('\n'));
  return { ok: true, result: { filePath: file, structuredPatch: [{ oldStart: i + 1, oldLines: 1, newStart: i + 1, newLines: 1, lines: ['-' + lines[i], '+' + after] }] } };
}
// A pasted Terminal line arrives as "Run exactly this as one command": run that command, like Claude would.
const pick = (prompt) => {
  const run = /^Run exactly this as one command[^\n]*\n```\n([\s\S]*?)\n```/.exec(prompt);
  if (run) return [{ say: 'Running it.\n' }, { tool: 'Bash', input: { command: run[1] } }];
  return SCENARIOS[Object.keys(SCENARIOS).find((k) => prompt.includes(`#${k}`)) || 'hello'];
};

function deniedByRule(rules, name, input) {
  return rules.some((r) => {
    const m = /^(\w+)\((.*)\)$/.exec(r);
    if (!m) return r.endsWith('*') ? name.startsWith(r.slice(0, -1)) : r === name;
    if (m[1] !== name || name !== 'Bash') return false;
    return String(input.command || '').startsWith(m[2].replace(/\s?\*$/, ''));
  });
}

export function createFakeClaude(spawnOpts, { delayMs = 2, keySource: forcedKey, answers = [] } = {}) {
  const args = spawnOpts.args || [];
  const cwd = spawnOpts.cwd || process.cwd();
  const stdin = new PassThrough(); const stdout = new PassThrough(); const ee = new EventEmitter();
  const sessionId = argValue(args, '--resume') || randomUUID();
  let mode = argValue(args, '--permission-mode') || 'default';
  const denyRules = (argValue(args, '--disallowedTools') || '').split(',').filter(Boolean);
  const keySource = forcedKey || (args.some((a) => a.includes('apiKeyHelper')) ? 'apiKeyHelper' : 'none');
  const hookIds = []; let hookBlocks = false;
  const waiting = new Map(); let turnAbort = null; const queue = []; let busy = false; let cost = 0;

  const proc = {
    stdin, stdout, killed: false, exitCode: null, signalCode: null,
    kill(sig) {
      if (proc.killed) return true;
      proc.killed = true; proc.exitCode = 0; proc.signalCode = sig; turnAbort?.abort(); stdout.end();
      setImmediate(() => ee.emit('exit', 0, sig)); return true;
    },
    on(e, f) { ee.on(e, f); return proc; }, once(e, f) { ee.once(e, f); return proc; }, off(e, f) { ee.off(e, f); return proc; },
  };
  const write = (o) => { if (!proc.killed) stdout.write(JSON.stringify(o) + '\n'); };
  const base = () => ({ uuid: randomUUID(), session_id: sessionId });
  const sleep = (ms, signal) => new Promise((res, rej) => {
    const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
  });
  const ask = (request, signal) => new Promise((resolve, reject) => {
    const id = randomUUID(); waiting.set(id, resolve);
    signal?.addEventListener('abort', () => { waiting.delete(id); write({ type: 'control_cancel_request', request_id: id }); reject(new Error('aborted')); }, { once: true });
    write({ type: 'control_request', request_id: id, request });
  });
  const ack = (id, response = {}) => write({ type: 'control_response', response: { subtype: 'success', request_id: id, response } });

  let buf = '';
  stdin.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.trim()) onInbound(JSON.parse(line));
    }
  });
  stdin.on('end', () => proc.kill('SIGTERM'));

  function onInbound(msg) {
    if (msg.type === 'control_request') {
      const r = msg.request;
      if (r.subtype === 'initialize') {
        for (const m of r.hooks?.PreToolUse || []) { hookIds.push(...m.hookCallbackIds); hookBlocks ||= m.onFailure === 'block'; }
        return ack(msg.request_id, { commands: [], agents: [], output_style: 'default', available_output_styles: ['default'], models: [], account: {}, hooks_applied: true, hook_on_failure_supported: true });
      }
      if (r.subtype === 'interrupt') { turnAbort?.abort(); return ack(msg.request_id); }
      if (r.subtype === 'set_permission_mode') { mode = r.mode; return ack(msg.request_id); }
      return ack(msg.request_id);
    }
    if (msg.type === 'control_response') { const res = waiting.get(msg.response.request_id); waiting.delete(msg.response.request_id); res?.(msg.response); return; }
    if (msg.type === 'user') { queue.push(msg); pump(); }
  }

  async function pump() {
    if (busy) return; busy = true;
    while (queue.length && !proc.killed) {
      const m = queue.shift();
      turnAbort = new AbortController();
      try { await runTurn(String(m.message.content), turnAbort.signal); } catch {
        if (proc.killed) break;
        write({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 0, duration_api_ms: 0, num_turns: 1, stop_reason: null, total_cost_usd: cost, usage: usage(), modelUsage: {}, permission_denials: [], errors: ['Interrupted by user'], ...base() });
      }
    }
    busy = false;
  }

  const usage = () => ({ input_tokens: 1200, output_tokens: 180, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
  const assistant = (content, parent = null) => write({ type: 'assistant', message: { id: 'msg_' + randomUUID().slice(0, 8), type: 'message', role: 'assistant', model: 'claude-mock', content, stop_reason: null, stop_sequence: null, usage: usage() }, parent_tool_use_id: parent, ...base() });
  const delta = (text) => write({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, parent_tool_use_id: null, ...base() });

  async function gate(name, input, toolUseId, step, signal) {
    for (const callback_id of hookIds) {
      const hookInput = { hook_event_name: 'PreToolUse', session_id: sessionId, transcript_path: '', cwd, permission_mode: mode, tool_name: name, tool_input: input, tool_use_id: toolUseId };
      const r = await ask({ subtype: 'hook_callback', callback_id, input: hookInput, tool_use_id: toolUseId }, signal);
      if (r.subtype === 'error') { if (hookBlocks) return { ok: false, why: 'Blocked: a safety hook failed.' }; continue; }
      const out = r.response?.hookSpecificOutput;
      if (out?.permissionDecision === 'deny') return { ok: false, why: out.permissionDecisionReason || 'Denied by hook' };
    }
    if (deniedByRule(denyRules, name, input)) return { ok: false, why: 'Denied by a permission rule' };
    if (mode === 'plan' && ['Edit', 'Write', 'Bash'].includes(name)) return { ok: false, why: 'Plan mode: nothing is changed' };
    if (step.allowRule) return { ok: true };
    const r = await ask({ subtype: 'can_use_tool', tool_name: name, input, tool_use_id: toolUseId }, signal);
    const answer = r.subtype === 'success' ? r.response : { behavior: 'deny', message: r.error };
    if (answer?.behavior !== 'allow') return { ok: false, why: answer?.message || 'Denied' };
    if (name === 'ExitPlanMode') mode = 'default'; // like Claude Code: an approved plan leaves plan mode
    // Like Claude Code: the question tool needs the answers back in its input, or nothing comes through.
    if (name === 'AskUserQuestion') { answers.push(answer.updatedInput?.answers ?? null); if (!answer.updatedInput?.answers) return { ok: false, why: 'No answer came back' }; }
    return name === 'Edit' ? applyEdit(cwd, input) : { ok: true };
  }

  async function runTurn(prompt, signal) {
    write({ type: 'system', subtype: 'init', apiKeySource: keySource, claude_code_version: 'mock', cwd, tools: ['Read', 'Edit', 'Write', 'Bash'], mcp_servers: [], model: 'claude-mock', permissionMode: mode, slash_commands: ['review', 'design-rules'], output_style: 'default', skills: [], plugins: [], ...base() });
    for (const step of pick(prompt)) {
      await sleep(delayMs, signal);
      if (step.parent) { assistant([{ type: 'text', text: step.say }], step.parent); continue; }
      if (step.say) { delta(step.say); assistant([{ type: 'text', text: step.say }]); continue; }
      if (step.chunks) { for (const c of step.chunks) delta(c); assistant([{ type: 'text', text: step.chunks.join('') }]); continue; }
      const toolUseId = 'toolu_' + randomUUID().replace(/-/g, '').slice(0, 20);
      assistant([{ type: 'tool_use', id: toolUseId, name: step.tool, input: step.input }]);
      const verdict = await gate(step.tool, step.input, toolUseId, step, signal);
      write({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: verdict.ok ? 'done' : verdict.why, is_error: !verdict.ok }] }, parent_tool_use_id: null, ...(verdict.result ? { tool_use_result: verdict.result } : {}), ...base() });
    }
    cost += 0.01;
    write({ type: 'result', subtype: 'success', is_error: false, duration_ms: 10, duration_api_ms: 10, num_turns: 1, result: 'ok', stop_reason: 'end_turn', total_cost_usd: cost, usage: usage(), modelUsage: { 'claude-mock': { contextWindow: 200000 } }, permission_denials: [], ...base() });
  }

  return proc;
}
