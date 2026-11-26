// budget.mjs - a daily spending cap across every project, and what each chat has cost.
// The SDK reports a RUNNING total per Claude Code process (result.total_cost_usd), and it is an
// estimate from Claude Code's own price list, not the bill. A chat that carries on in a new
// process (skill reload, restart, the app reopened) may start from the total the chat's
// transcript saved, or from $0 (sdk.d.ts 0.3.332, "a resumed or forked session continues from the
// total its transcript saved, when it has one"). Adding each process's total, as before, counted
// the carried part twice (bug found Nov 26). So we count only what each result adds, and keep per
// chat the last total and token counts seen: a new process whose first total and tokens cover
// those started from them: result.usage is this turn's main loop only, so in a carried-on total
// the tokens beyond this turn hold the earlier ones. Today's spend and the chat records live in a
// small JSON file.
export const localDay = (d = new Date()) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD, the Mac's own time zone
const KEEP = 100; // chats remembered
const sum = (...n) => n.reduce((a, x) => a + (Number(x) || 0), 0);

/** Token counts from a result: all = every call so far (modelUsage), turn = this turn's main loop (usage). */
export function tokensOf(modelUsage, usage) {
  const all = sum(...Object.values(modelUsage || {}).map((u) => sum(u?.inputTokens, u?.outputTokens, u?.cacheReadInputTokens, u?.cacheCreationInputTokens)));
  const turn = sum(usage?.input_tokens, usage?.output_tokens, usage?.cache_read_input_tokens, usage?.cache_creation_input_tokens);
  return { all, turn };
}
/** A new process carried on from the saved total when the tokens beyond this turn hold the earlier ones. */
const carried = (now, before) => !Number.isFinite(before?.all) || !now || now.all - now.turn >= before.all * 0.999;

export class Budget {
  /**
   * @param {number} capUsd  the daily cap
   * @param {{ store?: { load(): any, save(v: object): void } | null, today?: () => string }} [o]
   */
  constructor(capUsd, { store = null, today = localDay } = {}) {
    this.capUsd = capUsd; this.store = store; this.today = today;
    this.runs = new Map(); this.day = today(); this.total = 0; this.chats = {};
    let saved = null;
    try { saved = store?.load(); } catch { /* no file yet, or unreadable: start from zero */ }
    if (saved && typeof saved.chats === 'object' && saved.chats) this.chats = saved.chats;
    if (saved && saved.day === this.day && Number.isFinite(saved.spent) && saved.spent >= 0) this.total = saved.spent;
  }
  /** A new day: only what is spent from now on counts toward it. */
  rollover() { const d = this.today(); if (d !== this.day) { this.day = d; this.total = 0; } }
  /**
   * @param {string} run  one Claude Code process ("site#2")
   * @param {{ totalCostUsd?: number, sessionId?: string, tokens?: object }} r
   * @returns {number|null} what this chat has cost so far
   */
  record(run, { totalCostUsd: t, sessionId, tokens } = {}) {
    if (typeof t !== 'number' || !(t >= 0)) return null;
    this.rollover();
    let r = this.runs.get(run);
    if (!r) {
      const before = sessionId ? this.chats[sessionId] : null;
      r = { last: before && t >= before.usd && carried(tokens, before.tokens) ? before.usd : 0 };
      this.runs.set(run, r);
    }
    if (t < r.last) r.last = 0; // the running total started over (a /clear)
    const added = t - r.last; r.last = t; this.total += added;
    let chat = added;
    if (sessionId) {
      const c = this.chats[sessionId] || { cost: 0 };
      chat = c.cost + added;
      this.chats[sessionId] = { usd: t, tokens: tokens || null, cost: chat, at: Date.now() };
      const ids = Object.keys(this.chats);
      if (ids.length > KEEP) for (const id of ids.sort((a, b) => this.chats[a].at - this.chats[b].at).slice(0, ids.length - KEEP)) delete this.chats[id];
    }
    try { this.store?.save({ day: this.day, spent: this.spent, chats: this.chats }); } catch { /* the meter still works for this run */ }
    return Math.round(chat * 10000) / 10000;
  }
  /** What this chat has cost so far, from the record. */
  chatCost(sessionId) { return sessionId && this.chats[sessionId] ? Math.round(this.chats[sessionId].cost * 10000) / 10000 : null; }
  get spent() { this.rollover(); return Math.round(Math.max(0, this.total) * 10000) / 10000; }
  get left() { return Math.max(0, this.capUsd - this.spent); }
  get reached() { return this.spent >= this.capUsd; }
}
