// translate.mjs - SDK messages in, plain facts out. Pure: no I/O, no side effects.
//
// This is the ONLY file that reads SDK message shapes (sdk.d.ts, SDK 0.3.332). When the SDK
// changes a field, this is the file to fix, and test/translate.test.mjs says if you did.
// Returns { events: contract events, facts: things the session must act on }.
// Adapted from this project's code-health architect prototype.
import { event } from '../shared/contract.mjs';
import { explainToolCall } from '../shared/explain.mjs';

const WHY = /(?:^|\n)\s*Why:\s*([^\n]+)/;
const LONG_LINE = 400;
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Streamed text leaves whole lines at a time (or when the message ends), so redaction always
// sees a complete line and a key split across two chunks is never half-shown. An unfinished
// private-key block is held whole. A very long line without a break leaves at a space.
function release(st, final) {
  let cut = st.pending.length;
  if (!final) {
    const begin = st.pending.indexOf('-----BEGIN');
    const upto = begin >= 0 && !st.pending.includes('-----END', begin) ? begin : st.pending.length;
    cut = st.pending.lastIndexOf('\n', upto - 1) + 1;
    if (cut === 0 && upto > LONG_LINE) cut = st.pending.lastIndexOf(' ', upto) + 1;
  }
  const out = st.pending.slice(0, cut); st.pending = st.pending.slice(cut);
  return out;
}

const resultText = (c) => (typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '');

/** Per-session scratch state; translate() is the only thing that changes it. */
export const newScratch = (cwd = '/') => ({ cwd, partialSeen: false, textSinceTool: '', pending: '', whyByTool: new Map() });

export function translate(m, st) {
  const events = []; const facts = {};
  const top = !m?.parent_tool_use_id; // sub-agent chatter stays out of the main chat
  const flush = () => { const rest = release(st, true); if (rest) events.push(event('text', { text: rest })); };

  if (m?.type === 'system' && m.subtype === 'init') {
    facts.init = { sessionId: m.session_id, apiKeySource: m.apiKeySource, permissionMode: m.permissionMode, slashCommands: m.slash_commands || [] };
  }
  if (m?.type === 'stream_event' && top) {
    const e = m.event;
    if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
      st.partialSeen = true; st.textSinceTool += e.delta.text; st.pending += e.delta.text;
      const out = release(st, false);
      if (out) events.push(event('text', { text: out }));
    }
  }
  if (m?.type === 'assistant' && top) {
    flush();
    for (const b of m.message?.content || []) {
      if (b.type === 'text' && !st.partialSeen) { st.textSinceTool += b.text + '\n'; events.push(event('text', { text: b.text + '\n' })); }
      if (b.type !== 'tool_use') continue;
      const line = explainToolCall(b.name, b.input, st.cwd).plain;
      events.push(event('tool', { id: b.id, tool: b.name, line }));
      if (EDIT_TOOLS.has(b.name)) {
        const why = st.textSinceTool.match(WHY)?.[1]?.trim() || null;
        if (why) st.whyByTool.set(b.id, why);
        events.push(event('why', { seen: Boolean(why), why, line }));
      }
      st.textSinceTool = '';
      facts.toolStarted = line;
    }
    st.partialSeen = false;
    const u = m.message?.usage;
    if (u) facts.requestTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  }
  if (m?.type === 'user' && Array.isArray(m.message?.content)) {
    for (const b of m.message.content) {
      if (b.type !== 'tool_result') continue;
      (facts.toolResults ||= []).push({
        toolUseId: b.tool_use_id, ok: !b.is_error, text: resultText(b.content) || 'Not run.',
        hunks: Array.isArray(m.tool_use_result?.structuredPatch) ? m.tool_use_result.structuredPatch : null,
      });
    }
  }
  if (m?.type === 'result') {
    flush();
    const models = Object.values(m.modelUsage || {});
    facts.result = {
      ok: !m.is_error, totalCostUsd: m.total_cost_usd,
      windows: models.map((x) => x?.contextWindow), priceUnknown: models.some((x) => x?.costBasis === 'unknown'),
    };
  }
  return { events, facts };
}

/**
 * A past chat's messages (SDK getSessionMessages) as plain turns for the window: what you typed
 * and what Claude wrote, text only. Tool results, sub-agents and system notes are left out.
 * @returns {Array<{ who: 'you' | 'claude', text: string }>}
 */
export function pastTurns(messages, limit = 40) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || m.parent_tool_use_id || (m.type !== 'user' && m.type !== 'assistant')) continue;
    const c = m.message?.content;
    const text = (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '').trim();
    if (!text || (m.type === 'user' && /^<(command|local-command|system)/.test(text))) continue;
    out.push({ who: m.type === 'user' ? 'you' : 'claude', text: text.slice(0, 8000) });
  }
  return out.slice(-limit);
}
