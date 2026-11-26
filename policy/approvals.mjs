// approvals.mjs - turns the SDK's canUseTool callback into Allow / Deny cards.
//
// Deny by default, everywhere:
//   - only the exact string "allow" approves; anything else (including "Allow", true, "yes") denies
//   - abort (Stop, interrupt, session closed) denies
//   - timeout denies; no timer ever approves
//   - an answer counts once; a second answer to the same card is refused
//   - "allow" means allow ONCE: updatedPermissions ("always allow") is never returned
//   - "trash" (delete cards only) is a "no" too: the rm never runs; Claude is told to move
//     the same files to the Trash instead, which asks you again on a new card
//   - "allow_hour" counts only on a card that offers it (web lookups in Dev mode): it is an
//     allow once, plus onHour() so later web lookups in this project go ahead for an hour
//   - a question card (policy/questions.mjs) takes a tapped or typed answer, which goes back
//     inside the tool's input; a skip or anything that doesn't fit is a "no"
// One card, one answer: steps of one kind asked for together share a card (policy/grouping.mjs).
// A step that joins a card already up replaces it with a new card under a new id, so an answer
// only ever covers the steps that were on the card you saw; an answer to the old id is refused.
// Flow idea (pending map + race against the abort signal) from T3 Code (MIT), rewritten;
// adapted from this project's code-health architect prototype.
import { randomUUID } from 'node:crypto';
import { parseAnswer, typedAnswers, answeredLine, SKIPPED } from './questions.mjs';
import { groupKey, mergeCards } from './grouping.mjs';

export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
export const TRASH_INSTEAD = 'You chose Move to Trash instead, so nothing was deleted. Do not delete these files. '
  + 'Move the same files to ~/.Trash/ with mv -n (it never overwrites), then say in one sentence what moved and anything left behind.';
const NO = 'You said no, so it was not run.';

export class ApprovalBroker {
  /** @param {{ onOpen: (card, info?) => void, onClose: (id, decision, why, toolUseIDs) => void, onHour?: () => string, timeoutMs?: number, gatherMs?: number }} opts
   *  gatherMs: how long a new card waits for others of its kind before it shows (0 = shows at once). */
  constructor({ onOpen, onClose, onHour = () => '', timeoutMs = DEFAULT_TIMEOUT_MS, gatherMs = 0 }) {
    Object.assign(this, { onOpen, onClose, onHour, timeoutMs, gatherMs });
    this.pending = new Map(); // card id -> { key, members: [...], danger, hour, questions, timer, show, deadline }
  }

  get size() { return this.pending.size; }

  /** Ask the person. Resolves to the SDK's PermissionResult. */
  ask(toolName, input, sdkOptions = {}, card = {}) {
    const { signal, toolUseID } = sdkOptions;
    return new Promise((resolve) => {
      const m = { toolName, input, toolUseID, card, signal };
      m.finish = (decision, why, answers) => {
        signal?.removeEventListener('abort', m.onAbort);
        const answered = decision === 'answer' && answers && typeof answers === 'object';
        resolve(decision === 'allow' || answered
          ? { behavior: 'allow', updatedInput: answered ? { ...input, answers } : input, toolUseID }
          : { behavior: 'deny', message: why || NO, toolUseID });
      };
      m.onAbort = () => this.drop(m, 'Stopped before you answered, so it was not run.');
      if (signal?.aborted) { m.finish('deny', 'Stopped before you answered, so it was not run.'); return; }
      signal?.addEventListener('abort', m.onAbort, { once: true });
      const key = groupKey(toolName, card);
      const open = key && [...this.pending.values()].find((g) => g.key === key);
      if (open) this.reissue(open, [...open.members, m]); else this.place(key, [m], this.timeoutMs > 0 ? Date.now() + this.timeoutMs : 0, false);
    });
  }

  /** A card for these steps under a new id. Shows now, or after gatherMs when it's new. */
  place(key, members, deadline, again) {
    const id = randomUUID();
    const card = mergeCards(members.map((x) => ({ toolName: x.toolName, card: x.card })));
    const g = { id, key, members, deadline, danger: card.danger === true, hour: card.hour === true && card.danger !== true,
      questions: members.length === 1 && members[0].card.kind === 'question' ? members[0].input.questions : null };
    this.pending.set(id, g);
    if (deadline) g.timer = setTimeout(() => this.close(g, 'deny', 'No answer in time, so it was not run.'), Math.max(0, deadline - Date.now()));
    g.show = () => { g.show = null; this.onOpen({ id, ...card, trash: g.danger, hour: g.hour, defaultChoice: 'deny', ...(again ? { regrouped: true } : {}) }, { again }); };
    if (this.gatherMs > 0 && !again) g.wait = setTimeout(() => g.show?.(), this.gatherMs); else g.show();
    return g;
  }

  /** Take the card down without an answer, and put its steps on a new one. */
  reissue(g, members) {
    const shown = !g.show; this.unlist(g);
    if (!members.length) { if (shown) this.onClose(g.id, 'deny', 'Stopped before you answered, so it was not run.', []); return; }
    if (shown) this.onClose(g.id, 'merged', '', []); // the window swaps it for the new card
    this.place(g.key, members, g.deadline, shown);
  }

  /** One step went away (Claude stopped it): the card shows the rest. */
  drop(m, why) {
    const g = [...this.pending.values()].find((x) => x.members.includes(m));
    m.finish('deny', why);
    if (g) this.reissue(g, g.members.filter((x) => x !== m));
  }

  unlist(g) { this.pending.delete(g.id); clearTimeout(g.timer); clearTimeout(g.wait); }

  /** Answer every step on the card the same way, and tell the window once. */
  close(g, decision, why, answers) {
    if (!this.pending.has(g.id)) return;
    this.unlist(g);
    for (const m of g.members) m.finish(decision, why, answers);
    const answered = decision === 'answer' && answers && typeof answers === 'object';
    this.onClose(g.id, answered ? 'answer' : decision === 'allow' ? 'allow' : 'deny', why || '', g.members.map((m) => m.toolUseID).filter(Boolean));
  }

  /** The window's answer. Returns false for an unknown or already-answered id. */
  answer(id, decision) {
    const g = this.pending.get(id);
    if (!g) return false;
    if (g.questions) {
      const answers = parseAnswer(decision, g.questions);
      if (answers) this.close(g, 'answer', answeredLine(answers), answers); else this.close(g, 'deny', SKIPPED);
      return true;
    }
    // Strict equality on purpose. Do not "normalize" this (no toLowerCase, no trim).
    if (typeof decision === 'string' && decision === 'allow') this.close(g, 'allow');
    else if (decision === 'trash' && g.danger) this.close(g, 'deny', TRASH_INSTEAD);
    else if (decision === 'allow_hour' && g.hour) {
      const others = [...this.pending.values()].filter((x) => x !== g && x.hour); // web cards of another round, already up
      this.close(g, 'allow', this.onHour());
      for (const x of others) this.close(x, 'allow', 'Allowed for the hour with the card above.');
    } else this.close(g, 'deny', NO);
    return true;
  }

  /** Deny everything still waiting (Stop, shutdown, or a typed reply instead of an answer). */
  denyAll(why) { for (const g of [...this.pending.values()]) this.close(g, 'deny', why); }

  /** A typed message while a question waits is its answer. Returns whether one was waiting. */
  answerTyped(text) {
    const waiting = [...this.pending.values()].filter((g) => g.questions);
    for (const g of waiting) this.close(g, 'answer', 'You answered in the chat.', typedAnswers(text, g.questions));
    return waiting.length > 0;
  }
}
