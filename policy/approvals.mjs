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
//     allow once, plus onHour() so later web lookups in this project go ahead for an hour,
//     and the other web lookup cards already waiting are allowed with it
//   - a question card (policy/questions.mjs) takes a tapped or typed answer, which goes back
//     inside the tool's input; a skip or anything that doesn't fit is a "no"
// Flow idea (pending map + race against the abort signal) from T3 Code (MIT), rewritten;
// adapted from this project's code-health architect prototype.
import { randomUUID } from 'node:crypto';
import { parseAnswer, typedAnswers, answeredLine, SKIPPED } from './questions.mjs';

export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
export const TRASH_INSTEAD = 'You chose Move to Trash instead, so nothing was deleted. Do not delete these files. '
  + 'Move the same files to ~/.Trash/ with mv -n (it never overwrites), then say in one sentence what moved and anything left behind.';

export class ApprovalBroker {
  /** @param {{ onOpen: (card) => void, onClose: (id, decision, why, toolUseID) => void, onHour?: () => string, timeoutMs?: number }} opts */
  constructor({ onOpen, onClose, onHour = () => '', timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.onOpen = onOpen; this.onHour = onHour;
    this.onClose = onClose;
    this.timeoutMs = timeoutMs;
    this.pending = new Map(); // id -> { settle(decision, why, answers), questions }
    this.danger = new Set();  // ids of delete cards (the only ones that offer Move to Trash)
    this.hour = new Set();    // ids of cards that offer Allow for an hour
  }

  get size() { return this.pending.size; }

  /** Ask the person. Resolves to the SDK's PermissionResult. */
  ask(toolName, input, sdkOptions = {}, card = {}) {
    const id = randomUUID();
    const { signal, toolUseID } = sdkOptions;
    return new Promise((resolve) => {
      let timer = null;
      const onAbort = () => settle('deny', 'Stopped before you answered, so it was not run.');
      const settle = (decision, why, answers) => {
        if (!this.pending.delete(id)) return; // answered already: ignore
        this.danger.delete(id); this.hour.delete(id);
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const answered = decision === 'answer' && answers && typeof answers === 'object';
        const allowed = decision === 'allow' || answered;
        this.onClose(id, answered ? 'answer' : allowed ? 'allow' : 'deny', why || '', toolUseID);
        resolve(allowed
          ? { behavior: 'allow', updatedInput: answered ? { ...input, answers } : input, toolUseID }
          : { behavior: 'deny', message: why || 'You said no, so it was not run.', toolUseID });
      };
      this.pending.set(id, { settle, questions: card.kind === 'question' ? input.questions : null });
      if (card.danger === true) this.danger.add(id);
      if (card.hour === true && card.danger !== true) this.hour.add(id);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (this.timeoutMs > 0) { timer = setTimeout(() => settle('deny', 'No answer in time, so it was not run.'), this.timeoutMs); }
      this.onOpen({ id, toolName, ...card, trash: card.danger === true, hour: this.hour.has(id), defaultChoice: 'deny' });
    });
  }

  /** The window's answer. Returns false for an unknown or already-answered id. */
  answer(id, decision) {
    const p = this.pending.get(id);
    if (!p) return false;
    const { settle } = p;
    if (p.questions) {
      const answers = parseAnswer(decision, p.questions);
      if (answers) settle('answer', answeredLine(answers), answers); else settle('deny', SKIPPED);
      return true;
    }
    // Strict equality on purpose. Do not "normalize" this (no toLowerCase, no trim).
    if (typeof decision === 'string' && decision === 'allow') settle('allow');
    else if (decision === 'trash' && this.danger.has(id)) settle('deny', TRASH_INSTEAD);
    else if (decision === 'allow_hour' && this.hour.has(id)) {
      // Claude often runs several web lookups at once, so their cards are already up: the hour covers them too.
      const others = [...this.hour].filter((o) => o !== id).map((o) => this.pending.get(o)?.settle);
      settle('allow', this.onHour());
      for (const s of others) s?.('allow', 'Allowed for the hour with the card above.');
    }
    else settle('deny', 'You said no, so it was not run.');
    return true;
  }

  /** Deny everything still waiting (Stop, shutdown, or a typed reply instead of an answer). */
  denyAll(why) {
    for (const { settle } of [...this.pending.values()]) settle('deny', why);
  }

  /** A typed message while a question waits is its answer. Returns whether one was waiting. */
  answerTyped(text) {
    const waiting = [...this.pending.values()].filter((p) => p.questions);
    for (const p of waiting) p.settle('answer', 'You answered in the chat.', typedAnswers(text, p.questions));
    return waiting.length > 0;
  }
}
