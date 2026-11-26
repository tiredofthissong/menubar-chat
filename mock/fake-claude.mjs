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
  web: [{ say: 'Why: you asked which plants need shade.\n' }, { tool: 'WebFetch', input: { url: 'https://example.org/shade-plants', prompt: 'List shade plants' } }],
  bigjob: [{ say: 'This is a big job, so I am handing it to Claude Code.\nHandoff: Build a watering schedule page for the garden app & add tests.\n' }],
  bigread: [{ tool: 'Read', input: { file_path: 'notes.txt' } }, { say: 'Big job.\nHandoff: Rewrite every page.\n' }],
  smallwrite: [{ tool: 'Write', input: { file_path: 'notes.txt', content: 'fixed typo' } }],
  bigbuild: [{ say: 'Plan agreed.\n' }, { tool: 'Write', input: { file_path: 'repot.html', content: '<h1>Repot</h1>' }, big: 'Build the repot page as planned.' }],
  bigrun: [{ tool: 'Bash', input: { command: 'npm test' } }, { say: 'Big job.\nHandoff: Rewrite every page.\n' }],
  // Like Claude: several searches in one go, each asking at the same moment.
  searches: [{ say: 'Why: you asked which plants grow in shade.\n' }, { together: ['best shade plants', 'shade perennials', 'hostas ferns astilbe'].map((query) => ({ tool: 'WebSearch', input: { query } })) }],
  peek: [{ say: 'Why: you asked what sits next to this project.\n' }, { tool: 'Bash', input: { command: 'ls ..' }, readOnly: true }],
  lookhere: [{ tool: 'Bash', input: { command: 'ls -la' }, readOnly: true }],
  quoted: [{ tool: 'Bash', input: { command: 'echo "=== open questions ===" && cat notes.txt' } }],
  npm: [{ tool: 'Bash', input: { command: 'npm install', description: 'Install the garden app packages' } }],
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

const savedTotals = new Map(); // like Claude Code 2.1.332, a resumed chat can carry on from its saved total
export function createFakeClaude(spawnOpts, { delayMs = 2, keySource: forcedKey, answers = [], restoreCost = false } = {}) {
  const args = spawnOpts.args || [];
  const cwd = spawnOpts.cwd || process.cwd();
  const stdin = new PassThrough(); const stdout = new PassThrough(); const ee = new EventEmitter();
  const sessionId = argValue(args, '--resume') || randomUUID();
  let mode = argValue(args, '--permission-mode') || 'default';
  const denyRules = (argValue(args, '--disallowedTools') || '').split(',').filter(Boolean);
  const keySource = forcedKey || (args.some((a) => a.includes('apiKeyHelper')) ? 'apiKeyHelper' : 'none');
  const hookIds = []; let hookBlocks = false;
  const waiting = new Map(); let turnAbort = null; const queue = []; let busy = false;
  const carried = restoreCost && argValue(args, '--resume') ? savedTotals.get(sessionId) : null;
  let cost = carried?.cost ?? 0; let tokensIn = carried?.tokensIn ?? 0;
  const modelUsage = () => ({ 'claude-mock': { contextWindow: 200000, inputTokens: tokensIn, outputTokens: tokensIn * 0.15, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } });

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
  const delta = (text) => (lastText += text, write({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, parent_tool_use_id: null, ...base() }));

  async function gate(name, input, toolUseId, step, signal) {
    let hookAllowed = false;
    for (const callback_id of hookIds) {
      const hookInput = { hook_event_name: 'PreToolUse', session_id: sessionId, transcript_path: '', cwd, permission_mode: mode, tool_name: name, tool_input: input, tool_use_id: toolUseId };
      const r = await ask({ subtype: 'hook_callback', callback_id, input: hookInput, tool_use_id: toolUseId }, signal);
      if (r.subtype === 'error') { if (hookBlocks) return { ok: false, why: 'Blocked: a safety hook failed.' }; continue; }
      const out = r.response?.hookSpecificOutput;
      if (out?.permissionDecision === 'deny') return { ok: false, why: out.permissionDecisionReason || 'Denied by hook' };
      if (out?.permissionDecision === 'allow') hookAllowed = true;
    }
    if (deniedByRule(denyRules, name, input)) return { ok: false, why: 'Denied by a permission rule' };
    if (mode === 'plan' && ['Edit', 'Write', 'Bash'].includes(name)) return { ok: false, why: 'Plan mode: nothing is changed' };
    if (hookAllowed) return name === 'Edit' ? applyEdit(cwd, input) : { ok: true }; // a hook's allow skips the card
    if (step.allowRule || step.readOnly) return { ok: true }; // readOnly: Claude Code's own read-only commands
    const r = await ask({ subtype: 'can_use_tool', tool_name: name, input, tool_use_id: toolUseId }, signal);
    const answer = r.subtype === 'success' ? r.response : { behavior: 'deny', message: r.error };
    if (answer?.behavior !== 'allow') return { ok: false, why: answer?.message || 'Denied' };
    if (name === 'ExitPlanMode') mode = 'default'; // like Claude Code: an approved plan leaves plan mode
    // Like Claude Code: the question tool needs the answers back in its input, or nothing comes through.
    if (name === 'AskUserQuestion') { answers.push(answer.updatedInput?.answers ?? null); if (!answer.updatedInput?.answers) return { ok: false, why: 'No answer came back' }; }
    return name === 'Edit' ? applyEdit(cwd, input) : { ok: true };
  }

  let lastText = '';
  const handedOff = () => /Handoff:/.test(lastText);
  async function runTurn(prompt, signal) {
    lastText = '';
    write({ type: 'system', subtype: 'init', apiKeySource: keySource, claude_code_version: 'mock', cwd, tools: ['Read', 'Edit', 'Write', 'Bash'], mcp_servers: [], model: 'claude-mock', permissionMode: mode, slash_commands: ['review', 'design-rules'], output_style: 'default', skills: [], plugins: [], ...base() });
    for (const step of pick(prompt)) {
      await sleep(delayMs, signal);
      if (step.parent) { assistant([{ type: 'text', text: step.say }], step.parent); continue; }
      if (step.say) { delta(step.say); assistant([{ type: 'text', text: step.say }]); continue; }
      if (step.chunks) { for (const c of step.chunks) delta(c); assistant([{ type: 'text', text: step.chunks.join('') }]); continue; }
      const group = step.together || [step];
      // Like Claude at the app's hand-off check: a big step hands off, anything else tries again once.
      for (let tries = 0; tries < 2; tries++) {
        const ids = group.map(() => 'toolu_' + randomUUID().replace(/-/g, '').slice(0, 20));
        assistant(group.map((s, i) => ({ type: 'tool_use', id: ids[i], name: s.tool, input: s.input })));
        const verdicts = await Promise.all(group.map((s, i) => gate(s.tool, s.input, ids[i], s, signal)));
        verdicts.forEach((verdict, i) => write({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: ids[i], content: verdict.ok ? 'done' : verdict.why, is_error: !verdict.ok }] }, parent_tool_use_id: null, ...(verdict.result ? { tool_use_result: verdict.result } : {}), ...base() }));
        if (!verdicts.some((v) => /^Not run yet: this app checks the hand-off rule/.test(v.why || ''))) break;
        if (step.big) { const t = `Handing this to Claude Code.\nHandoff: ${step.big}\n`; delta(t); assistant([{ type: 'text', text: t }]); break; }
      }
      if (step.big && handedOff()) break;
    }
    cost += 0.01; tokensIn += 1200; savedTotals.set(sessionId, { cost, tokensIn }); // usage() is 1200 in, 180 out
    write({ type: 'result', subtype: 'success', is_error: false, duration_ms: 10, duration_api_ms: 10, num_turns: 1, result: 'ok', stop_reason: 'end_turn', total_cost_usd: cost, usage: usage(), modelUsage: modelUsage(), permission_denials: [], ...base() });
  }

  return proc;
}
