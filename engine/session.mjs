// session.mjs - one project folder = one long-lived SDK query = one Claude Code process.
// Talks to the outside world only through emit(event). Failure rule: anything unexpected
// ends the turn and DENIES whatever is waiting.
import { ApprovalBroker } from '../policy/approvals.mjs';
import { makePreToolUseHook } from '../policy/hook.mjs';
import { checkToolCall } from '../policy/rules.mjs';
import { START_MODE } from '../policy/modes.mjs';
import { buildQueryOptions } from './options.mjs';
import { checkInit } from './init-check.mjs';
import { createInputQueue } from './input-queue.mjs';
import { explainToolCall } from './explain.mjs';
import { LineBuffer, redact } from './redact.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export class ProjectSession {
  /**
   * @param {object} d
   * @param {{ name: string, path: string, tag: string }} d.project
   * @param {{ query: Function }} d.sdk
   * @param {(ev: object) => void} d.emit           every event carries { project }
   * @param {import('./status.mjs').StatusBoard} d.status
   * @param {import('./budget.mjs').Budget} d.budget
   * @param {{ keychainService?: string|null, spawn?: Function, hubPaths?: string[], approvalTimeoutMs?: number }} d.settings
   */
  constructor({ project, sdk, emit, status, budget, settings }) {
    Object.assign(this, { project, sdk, status, budget, settings });
    this.emit = (ev) => emit({ project: project.name, ...ev });
    this.mode = START_MODE;
    this.sessionId = null; this.q = null; this.input = null;
    this.resetTurn();
    this.broker = new ApprovalBroker({
      timeoutMs: settings.approvalTimeoutMs,
      onOpen: (card) => { this.turn.approvals++; this.cards(); this.emit({ type: 'approval', card }); },
      onClose: (id, decision, why) => { this.cards(); this.emit({ type: 'approval_closed', id, decision, why }); },
    });
  }

  resetTurn() { this.turn = { approvals: 0, textSinceTool: '', streamed: false }; this.lines = new LineBuffer(); }
  cards() { this.status.setPendingCards(this.project.name, this.broker.size); this.emit({ type: 'status' }); }
  setStatus(state, detail) { this.status.set(this.project.name, state, detail); this.emit({ type: 'status' }); }

  /** canUseTool: the hard rules again (second line), then the person. */
  canUseTool = async (toolName, input, opts) => {
    const verdict = checkToolCall({ project: this.project, hubPaths: this.settings.hubPaths }, toolName, input);
    if (verdict.decision === 'deny') return { behavior: 'deny', message: verdict.plain, toolUseID: opts?.toolUseID };
    return this.broker.ask(toolName, input, opts, explainToolCall(toolName, input, this.project.path));
  };

  start() {
    this.input = createInputQueue();
    const options = buildQueryOptions({
      project: this.project, mode: this.mode, hubPaths: this.settings.hubPaths,
      canUseTool: this.canUseTool,
      preToolUseHook: makePreToolUseHook({ project: this.project, hubPaths: this.settings.hubPaths,
        onBlocked: (rule, plain) => this.emit({ type: 'blocked', rule, plain }) }),
      keychainService: this.settings.keychainService ?? null, resumeId: this.sessionId,
      budgetUsd: this.budget.left, spawn: this.settings.spawn,
    });
    const q = this.sdk.query({ prompt: this.input, options });
    this.q = q;
    this.pump(q);
  }

  async pump(q) {
    try {
      for await (const m of q) this.onMessage(m);
    } catch {
      this.emit({ type: 'error', code: 'engine-lost', text: 'The connection to Claude ended. Your files are safe; send your message again to restart.' });
      this.setStatus('error', 'connection ended');
    } finally {
      if (this.q === q) { this.q = null; this.input = null; }
      this.broker.denyAll('The session ended before you answered.');
    }
  }

  onMessage(m) {
    if (m.type === 'system' && m.subtype === 'init') {
      const verdict = checkInit(m, this.mode);
      if (!verdict.ok) { this.emit({ type: 'error', code: verdict.code, text: verdict.text }); this.setStatus('error', 'stopped for safety'); this.close(); return; }
      this.sessionId = m.session_id;
      return;
    }
    if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') {
      this.turn.streamed = true;
      const ready = this.lines.push(m.event.delta.text);
      if (ready) this.emit({ type: 'text', text: ready });
      return;
    }
    if (m.type === 'assistant') return this.onAssistant(m.message?.content || []);
    if (m.type === 'user') {
      for (const b of Array.isArray(m.message?.content) ? m.message.content : []) {
        if (b.type === 'tool_result' && b.is_error) this.emit({ type: 'tool_failed', text: redact(typeof b.content === 'string' ? b.content : 'Not run.') });
      }
      return;
    }
    if (m.type === 'result') {
      const rest = this.lines.flush(); if (rest) this.emit({ type: 'text', text: rest });
      this.budget.record(this.project.name, m.total_cost_usd);
      this.emit({ type: 'turn_done', ok: !m.is_error, approvals: this.turn.approvals, costUsd: m.total_cost_usd ?? 0, spentUsd: this.budget.spent, capUsd: this.budget.capUsd });
      this.resetTurn();
      this.setStatus('idle');
      if (this.budget.reached) this.close();
    }
  }

  onAssistant(blocks) {
    for (const b of blocks) {
      if (b.type === 'text') {
        this.turn.textSinceTool += b.text + '\n';
        if (!this.turn.streamed) this.emit({ type: 'text', text: redact(b.text + '\n') });
      } else if (b.type === 'tool_use') {
        const rest = this.lines.flush(); if (rest) this.emit({ type: 'text', text: rest });
        const ex = explainToolCall(b.name, b.input, this.project.path);
        this.emit({ type: 'tool', tool: b.name, line: ex.plain });
        if (EDIT_TOOLS.has(b.name)) {
          const why = this.turn.textSinceTool.match(/^\s*Why:\s*(.+)$/m)?.[1] || null;
          this.emit({ type: 'why', seen: Boolean(why), why: why ? redact(why) : null, line: ex.plain });
        }
        this.turn.textSinceTool = '';
        this.setStatus('working', ex.plain.slice(0, 60));
      }
    }
    this.turn.streamed = false;
  }

  send(text) {
    if (this.budget.reached) { this.emit({ type: 'error', code: 'budget', text: `This test run reached its $${this.budget.capUsd} cap, so nothing more was sent.` }); return; }
    // Typing while a card waits answers the card: it's a "no", with the words as the reason.
    if (this.broker.size) { this.broker.denyAll(`You said no and wrote: ${text}`); }
    if (!this.q) this.start();
    this.setStatus('thinking');
    this.input.push({ type: 'user', session_id: this.sessionId || '', parent_tool_use_id: null, message: { role: 'user', content: text } });
  }

  answer(id, decision) { return this.broker.answer(id, decision); }

  async stop() {
    this.broker.denyAll('Stopped before you answered, so it was not run.');
    try { await this.q?.interrupt(); } catch { /* already ended */ }
    this.setStatus('stopped');
  }

  close() {
    this.broker.denyAll('The session was closed before you answered.');
    this.input?.end();
    try { this.q?.close?.(); } catch { /* already closed */ }
    this.q = null; this.input = null;
  }
}
