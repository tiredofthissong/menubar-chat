// session.mjs - one project folder = one long-lived SDK query = one Claude Code process.
// Owns the query, its input queue, the approval broker, the change copies and the meter.
// Talks to the outside world only through emit(event); reads SDK shapes only via translate.mjs.
// Failure rule: anything unexpected ends the turn and DENIES whatever is waiting.
import { event } from '../shared/contract.mjs';
import { explainToolCall } from '../shared/explain.mjs';
import { classifyInput } from '../shared/input.mjs';
import { ApprovalBroker } from '../policy/approvals.mjs';
import { makePreToolUseHook } from '../policy/hook.mjs';
import { checkToolCall } from '../policy/rules.mjs';
import { START_MODE, requestMode, MODES } from '../policy/modes.mjs';
import { ChangeStore } from '../changes/changes.mjs';
import { createMeter } from '../usage/meter.mjs';
import { buildQueryOptions } from './options.mjs';
import { checkInit } from './init-check.mjs';
import { createInputQueue } from './input-queue.mjs';
import { translate, newScratch } from './translate.mjs';

export class ProjectSession {
  /**
   * @param {object} d
   * @param {{ name: string, path: string, tag: string }} d.project
   * @param {{ query: Function }} d.sdk
   * @param {(ev: object) => void} d.emit           every event carries { project }
   * @param {import('../status/status.mjs').StatusBoard} d.status
   * @param {import('../usage/budget.mjs').Budget} d.budget
   * @param {{ keychainService?: string|null, spawn?: Function, hubPaths?: string[], approvalTimeoutMs?: number, model?: string }} d.settings
   * @param {object} [d.log]
   */
  constructor({ project, sdk, emit, status, budget, settings, log }) {
    Object.assign(this, { project, sdk, status, budget, settings, log });
    this.emit = (ev) => emit({ ...ev, project: project.name });
    this.mode = START_MODE;
    this.sessionId = null; this.slashCommands = null; this.q = null; this.input = null;
    this.changes = new ChangeStore(project.path);
    this.meter = createMeter();
    this.explained = new Set(); // tool calls already explained once (a card's no, or "Blocked")
    this.approvals = 0;
    this.broker = new ApprovalBroker({
      timeoutMs: settings.approvalTimeoutMs,
      onOpen: (card) => { this.approvals++; this.cards(); this.emit(event('approval', { card })); },
      onClose: (id, decision, why, toolUseID) => {
        if (decision !== 'allow' && toolUseID) { this.explained.add(toolUseID); this.changes.forget(toolUseID); }
        // Claude gets the long reason; the window gets a short one.
        const said = why.startsWith('You chose Move to Trash') ? 'You chose Move to Trash instead.' : why;
        this.cards(); this.emit(event('approval_closed', { id, decision, why: said }));
      },
    });
  }

  cards() { this.status.setPendingCards(this.project.name, this.broker.size); this.emit(event('status')); }
  setStatus(state, detail) { this.status.set(this.project.name, state, detail); this.emit(event('status')); }

  /** canUseTool: the hard rules again (second line), then the person. */
  canUseTool = async (toolName, input, opts) => {
    const verdict = checkToolCall({ project: this.project, hubPaths: this.settings.hubPaths }, toolName, input);
    if (verdict.decision === 'deny') return { behavior: 'deny', message: verdict.plain, toolUseID: opts?.toolUseID };
    const answer = await this.broker.ask(toolName, input, opts, explainToolCall(toolName, input, this.project.path));
    // Leaving Plan first: once you allow the plan, Claude Code goes back to asking before each step.
    if (toolName === 'ExitPlanMode' && answer.behavior === 'allow' && this.mode === 'plan') this.noteMode('default');
    return answer;
  };

  noteMode(mode) { this.mode = mode; this.emit(event('mode', { mode, label: MODES[mode] })); }

  start() {
    this.input = createInputQueue();
    this.scratch = newScratch(this.project.path);
    const hubPaths = this.settings.hubPaths;
    const options = buildQueryOptions({
      project: this.project, mode: this.mode, hubPaths, canUseTool: this.canUseTool,
      preToolUseHook: makePreToolUseHook({ project: this.project, hubPaths, changes: this.changes,
        onBlocked: (rule, plain, id) => { if (id) this.explained.add(id); this.emit(event('blocked', { rule, plain })); } }),
      keychainService: this.settings.keychainService ?? null, resumeId: this.sessionId,
      budgetUsd: this.budget.left, spawn: this.settings.spawn, model: this.settings.model,
    });
    const q = this.sdk.query({ prompt: this.input, options });
    this.q = q;
    this.pump(q);
  }

  async pump(q) {
    try {
      for await (const m of q) this.onMessage(m);
    } catch (e) {
      this.log?.warn('engine', 'query ended with an error', { project: this.project.name, error: e });
      this.emit(event('error', { code: 'engine-lost', text: 'The connection to Claude ended. Your files are safe; send your message again to restart.' }));
      this.setStatus('error', 'connection ended');
    } finally {
      if (this.q === q) { this.q = null; this.input = null; }
      this.broker.denyAll('The session ended before you answered.');
      this.emit(event('closed'));
    }
  }

  onMessage(m) {
    const { events, facts } = translate(m, this.scratch);
    if (facts.init) {
      const verdict = checkInit(facts.init, this.mode);
      if (!verdict.ok) { this.emit(event('error', { code: verdict.code, text: verdict.text })); this.setStatus('error', 'stopped for safety'); this.close(); return; }
      const fresh = this.sessionId !== facts.init.sessionId;
      this.sessionId = facts.init.sessionId; this.slashCommands = facts.init.slashCommands;
      if (fresh) this.emit(event('session', { sessionId: this.sessionId, mode: this.mode }));
    }
    for (const ev of events) this.emit(ev);
    if (facts.toolStarted) this.setStatus('working', facts.toolStarted.slice(0, 60));
    if (facts.requestTokens !== undefined) this.meter.onRequestTokens(facts.requestTokens);
    for (const r of facts.toolResults || []) this.onToolResult(r);
    if (facts.result) this.onResult(facts.result);
  }

  onToolResult(r) {
    if (!r.ok) {
      this.changes.forget(r.toolUseId);
      if (!this.explained.delete(r.toolUseId)) this.emit(event('tool_failed', { text: r.text })); // say a "no" once, not twice
      return;
    }
    const card = this.changes.recordAfter(r.toolUseId, { hunks: r.hunks, why: this.scratch.whyByTool.get(r.toolUseId) });
    if (card) this.emit(event('change', card));
  }

  onResult(res) {
    this.budget.record(this.project.name, res.totalCostUsd);
    this.meter.onResult(res);
    const { spent: spentUsd, capUsd } = this.budget;
    this.emit(event('usage', { ...this.meter.snapshot(), spentUsd, capUsd }));
    this.emit(event('turn_done', { ok: res.ok, approvals: this.approvals, costUsd: res.totalCostUsd ?? 0, spentUsd, capUsd }));
    this.approvals = 0;
    this.setStatus('idle');
    if (this.budget.reached) this.close();
  }

  send(text) {
    if (this.budget.reached) { this.emit(event('error', { code: 'budget', text: `Today's spending reached the $${this.budget.capUsd} daily cap, so nothing more was sent. It starts over at midnight.` })); return; }
    // Typing while a card waits answers the card: it's a "no", with the words as the reason.
    if (this.broker.size) this.broker.denyAll('You sent a new message instead, so it was not run.');
    // Pasted Terminal lines, "claude ...", "!cmd" and mistyped /commands get one calm line.
    const c = classifyInput(text, { commands: this.slashCommands?.length ? this.slashCommands : null, project: this.project.name });
    if (c.note) this.emit(event('hint', { kind: c.kind, text: c.note, ...(c.suggestion ? { suggestion: c.suggestion } : {}) }));
    if (c.action === 'newChat') { this.resume(null); this.emit(event('session', { sessionId: null, mode: this.mode })); }
    if (!c.send) return;
    if (!this.q) this.start();
    this.setStatus('thinking');
    this.input.push({ type: 'user', session_id: this.sessionId || '', parent_tool_use_id: null, message: { role: 'user', content: c.send } });
  }

  answer(id, decision) { return this.broker.answer(id, decision); }

  async setMode(wanted) {
    const r = requestMode(wanted);
    if (!r.ok) return r;
    const was = this.mode;
    this.mode = r.mode; // set first, so a start frame that arrives meanwhile matches
    if (r.mode !== was && this.q) {
      try { await this.q.setPermissionMode(r.mode); } catch { this.mode = was; return { ok: false, text: "Claude didn't take the new mode, so it stays as it was." }; }
    }
    this.noteMode(r.mode);
    return r;
  }

  undo(changeId) {
    const r = this.changes.undo(changeId);
    this.emit(event('undo_result', { id: changeId, ok: r.ok, text: r.text }));
    return r;
  }

  /** Pick up a past chat (or start fresh with null). Anything waiting is denied first. */
  resume(sessionId) { this.close(); this.sessionId = sessionId; this.meter.reset(); }

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
