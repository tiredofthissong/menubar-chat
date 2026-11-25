// approvals.mjs - turns the SDK's canUseTool callback into Allow / Deny cards.
//
// Deny by default, everywhere:
//   - only the exact string "allow" approves; anything else (including "Allow", true, "yes") denies
//   - abort (Stop, interrupt, session closed) denies
//   - timeout denies; no timer ever approves
//   - an answer counts once; a second answer to the same card is refused
//   - "allow" means allow ONCE: updatedPermissions ("always allow") is never returned
// Flow idea (pending map + race against the abort signal) from T3 Code (MIT), rewritten;
// adapted from this project's code-health architect prototype.
import { randomUUID } from 'node:crypto';

export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

export class ApprovalBroker {
  /** @param {{ onOpen: (card) => void, onClose: (id, decision, why) => void, timeoutMs?: number }} opts */
  constructor({ onOpen, onClose, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.timeoutMs = timeoutMs;
    this.pending = new Map(); // id -> settle(decision, why)
  }

  get size() { return this.pending.size; }

  /** Ask the person. Resolves to the SDK's PermissionResult. */
  ask(toolName, input, sdkOptions = {}, card = {}) {
    const id = randomUUID();
    const { signal, toolUseID } = sdkOptions;
    return new Promise((resolve) => {
      let timer = null;
      const onAbort = () => settle('deny', 'Stopped before you answered, so it was not run.');
      const settle = (decision, why) => {
        if (!this.pending.delete(id)) return; // answered already: ignore
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const allowed = decision === 'allow';
        this.onClose(id, allowed ? 'allow' : 'deny', why || '');
        resolve(allowed
          ? { behavior: 'allow', updatedInput: input, toolUseID }
          : { behavior: 'deny', message: why || 'You said no.', toolUseID });
      };
      this.pending.set(id, settle);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (this.timeoutMs > 0) { timer = setTimeout(() => settle('deny', 'No answer in time, so it was not run.'), this.timeoutMs); }
      this.onOpen({ id, toolName, ...card, defaultChoice: 'deny' });
    });
  }

  /** The window's answer. Returns false for an unknown or already-answered id. */
  answer(id, decision) {
    const settle = this.pending.get(id);
    if (!settle) return false;
    // Strict equality on purpose. Do not "normalize" this (no toLowerCase, no trim).
    if (typeof decision === 'string' && decision === 'allow') settle('allow');
    else settle('deny', 'You said no.');
    return true;
  }

  /** Deny everything still waiting (Stop, shutdown, or a typed reply instead of an answer). */
  denyAll(why) {
    for (const settle of [...this.pending.values()]) settle('deny', why);
  }
}
