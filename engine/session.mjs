// session.mjs - one project folder = one long-lived SDK query = one Claude Code process. Owns the
// query, input queue, approval broker, change copies and meter. Talks out only through emit(event).
// Failure rule: anything unexpected ends the turn and DENIES whatever is waiting.
import { event } from '../shared/contract.mjs';
import { classifyInput } from '../shared/input.mjs';
import { ApprovalBroker, DEFAULT_TIMEOUT_MS } from '../policy/approvals.mjs';
import { makePreToolUseHook } from '../policy/hook.mjs';
import { START_MODE, requestMode, MODES, claudeCodeMode } from '../policy/modes.mjs';
import { createPermit } from './permit.mjs';
import { ChangeStore } from '../changes/changes.mjs';
import { createMeter } from '../usage/meter.mjs';
import { buildQueryOptions } from './options.mjs';
import { checkInit } from './init-check.mjs';
import { createInputQueue } from './input-queue.mjs';
import { translate, newScratch } from './translate.mjs';
import { pullNext } from './next.mjs';
import { pullHandoff, handoffUrl, HANDED, NOT_OPENED, createHandoffNudge } from './handoff.mjs';
import { explainToolCall } from '../shared/explain.mjs';
import { looksInside } from '../policy/devmode.mjs';
import { createLearnPicker } from '../shared/learn.mjs';
import { skillDirs, skillStamp } from './skills.mjs';

// The hook may wait for your answer (an outside look), so it gets as long as a card does, plus a margin.
const hookTimeoutSec = (ms = DEFAULT_TIMEOUT_MS) => (ms > 0 ? Math.ceil(ms / 1000) + 30 : 24 * 3600);

export class ProjectSession {
  /** d: { project {name,path,tag}, sdk {query}, emit (every event carries {project}), status, budget,
   *  settings {keychainService?, spawn?, hubPaths?, approvalTimeoutMs?, model?}, log? } */
  constructor({ project, sdk, emit, status, budget, settings, log }) {
    Object.assign(this, { project, sdk, status, budget, settings, log });
    this.emit = (ev) => emit({ ...ev, project: project.name });
    this.mode = START_MODE;
    this.sessionId = null; this.slashCommands = null; this.q = null; this.input = null; this.learn = createLearnPicker();
    this.changes = new ChangeStore(project.path);
    this.meter = createMeter();
    this.explained = new Set(); // tool calls already explained once (a card's no, or "Blocked")
    this.approvals = 0; this.next = []; this.hand = { prompt: null }; this.ran = new Set(); this.nudge = createHandoffNudge(explainToolCall); this.runNo = 0; // runNo: each Claude Code process counts apart toward today
    this.permit = createPermit(this, { now: settings.now });
    this.broker = new ApprovalBroker({
      timeoutMs: settings.approvalTimeoutMs, gatherMs: settings.gatherMs ?? 120, onHour: () => this.permit.onHour(),
      onOpen: (card, info) => { if (!info?.again) this.approvals++; this.cards(); this.emit(event('approval', { card })); },
      onClose: (id, decision, why, toolUseIDs = []) => {
        if (decision === 'deny') for (const t of toolUseIDs) { this.explained.add(t); this.changes.forget(t); }
        // Claude gets the long reason; the window gets a short one.
        const said = why.startsWith('You chose Move to Trash') ? 'You chose Move to Trash instead.' : why;
        this.cards(); this.emit(event('approval_closed', { id, decision, why: said }));
      },
    });
  }

  cards() { this.status.setPendingCards(this.project.name, this.broker.size); this.emit(event('status')); }
  setStatus(state, detail) { this.status.set(this.project.name, state, detail); this.emit(event('status')); }

  /** Claude Code's "may I?" and the hook's "ask first" both live in engine/permit.mjs. */
  canUseTool = (toolName, input, opts) => this.permit.canUseTool(toolName, input, opts);

  noteMode(mode) { this.mode = mode; this.emit(event('mode', { mode, label: MODES[mode] })); }

  /** Start Claude Code before the first message, so the first reply comes sooner. Costs nothing. */
  warm() { if (!this.q && !this.budget.reached) this.start(); }

  start() {
    this.run = `${this.project.name}#${++this.runNo}`; // the budget works out where a restart's cost total starts
    this.skills = skillStamp(skillDirs(this.project.path, this.settings.home));
    this.input = createInputQueue();
    this.scratch = newScratch(this.project.path);
    const hubPaths = this.settings.hubPaths;
    const options = buildQueryOptions({
      project: this.project, mode: this.mode, hubPaths, canUseTool: this.canUseTool,
      preToolUseHook: makePreToolUseHook({ project: this.project, hubPaths, changes: this.changes, askFirst: this.permit.askFirst,
        nudge: (tool, input, id) => { const held = this.nudge.check(tool, input, id); if (held && id) { this.explained.add(id); this.heldLine = explainToolCall(tool, input, this.project.path).plain; } return held; },
        onBlocked: (rule, plain, id) => { if (id) this.explained.add(id); this.emit(event('blocked', { rule, plain })); } }),
      keychainService: this.settings.keychainService ?? null, resumeId: this.sessionId,
      budgetUsd: this.budget.left, spawn: this.settings.spawn, model: this.settings.model, hookTimeoutSec: hookTimeoutSec(this.settings.approvalTimeoutMs),
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
      const verdict = checkInit(facts.init, claudeCodeMode(this.mode));
      if (!verdict.ok) { this.emit(event('error', { code: verdict.code, text: verdict.text })); this.setStatus('error', 'stopped for safety'); this.close(); return; }
      const fresh = this.sessionId !== facts.init.sessionId;
      this.sessionId = facts.init.sessionId; this.slashCommands = facts.init.slashCommands;
      if (fresh) this.emit(event('session', { sessionId: this.sessionId, mode: this.mode }));
    }
    for (const ev of events) {
      if (ev.type !== 'text') { if (!(ev.type === 'tool' && ev.line === this.heldLine)) this.emit(ev); continue; } // a step tried again after the check shows once
      const text = pullHandoff(pullNext(ev.text, this.next), this.hand); // "Next:" lines become buttons; a "Handoff:" line opens Claude Code
      if (text) this.emit({ ...ev, text });
    }
    if (facts.toolStarted) this.setStatus('working', facts.toolStarted.slice(0, 60));
    for (const t of facts.toolCalls || []) if (!looksInside(t.name, t.input, this.project.path)) this.ran.add(t.id); // reading here is fine
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
    this.meter.onResult({ ...res, chatUsd: this.budget.record(this.run, res) });
    const { spent: spentUsd, capUsd } = this.budget;
    this.emit(event('usage', { ...this.meter.snapshot(), spentUsd, capUsd }));
    if (this.next.length) this.emit(event('suggestions', { items: this.next }));
    const url = handoffUrl(this.hand.prompt, this.project.path); // after more than reading here, it never opens by itself
    const more = [...this.ran].some((id) => !this.nudge.wasHeld(id)); // a step the check held back never ran
    if (url) this.emit(event('handoff', { prompt: this.hand.prompt, url, auto: !more, line: more ? NOT_OPENED : HANDED }));
    this.next = [];
    this.emit(event('turn_done', { ok: res.ok, approvals: this.approvals, costUsd: res.totalCostUsd ?? 0, spentUsd, capUsd }));
    this.approvals = 0; this.turnOpen = false;
    this.setStatus('idle');
    if (this.budget.reached) this.close();
  }

  send(text) {
    this.next = []; this.hand = { prompt: null }; this.ran.clear(); this.nudge.newTurn(text); this.heldLine = null;
    if (this.budget.reached) { this.emit(event('error', { code: 'budget', text: `Today's spending reached the $${this.budget.capUsd} daily cap, so nothing more was sent. It starts over at midnight.` })); return; }
    // Typing while a question waits answers it; while any other card waits, it's a "no".
    if (this.broker.answerTyped(text)) return;
    if (this.broker.size) this.broker.denyAll('You sent a new message instead, so it was not run.');
    if (this.q && !this.turnOpen && skillStamp(skillDirs(this.project.path, this.settings.home)) !== this.skills) {
      this.close(); this.slashCommands = null;
      this.emit(event('hint', { kind: 'skills', text: 'Found new or changed skills, so Claude picked them up. Your chat carries on.' }));
    }
    // Pasted Terminal lines, "claude ...", "!cmd" and mistyped /commands get one calm line.
    const c = classifyInput(text, { commands: this.slashCommands?.length ? this.slashCommands : null, project: this.project.name });
    if (c.note) this.emit(event('hint', { kind: c.kind, text: c.note, ...(c.suggestion ? { suggestion: c.suggestion } : {}) }));
    if (c.action === 'newChat') { this.resume(null); this.emit(event('session', { sessionId: null, mode: this.mode })); }
    if (!c.send) return;
    if (!this.q) this.start();
    this.turnOpen = true; this.setStatus('thinking');
    this.input.push({ type: 'user', session_id: this.sessionId || '', parent_tool_use_id: null, message: { role: 'user', content: c.send } });
  }

  answer(id, decision) { return this.broker.answer(id, decision); }

  async setMode(wanted) {
    const r = requestMode(wanted);
    if (!r.ok) return r;
    const was = this.mode;
    this.mode = r.mode; // set first, so a start frame that arrives meanwhile matches
    if (r.mode !== was && this.q) {
      try { if (claudeCodeMode(r.mode) !== claudeCodeMode(was)) await this.q.setPermissionMode(claudeCodeMode(r.mode)); } catch { this.mode = was; return { ok: false, text: "Claude didn't take the new mode, so it stays as it was." }; }
    }
    if (r.mode !== was) this.permit.pass.end(); // the web pass ends when you switch mode
    this.noteMode(r.mode);
    return r;
  }

  undo(changeId) {
    const r = this.changes.undo(changeId);
    this.emit(event('undo_result', { id: changeId, ok: r.ok, text: r.text }));
    return r;
  }

  /** Pick up a past chat (or start fresh with null). Anything waiting is denied first. */
  resume(sessionId) { this.close(); this.sessionId = sessionId; this.meter.reset(this.budget.chatCost(sessionId) ?? 0); this.learn = createLearnPicker(); this.permit.pass.end(); }

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
