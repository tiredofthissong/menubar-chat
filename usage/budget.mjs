// budget.mjs - a daily spending cap across every project.
// The SDK reports a running total per query (result.total_cost_usd); we keep the latest per
// Claude Code process ("project#1", "project#2" after a New chat or restart) and add them all up,
// so a restart never drops what that project already spent today (bug found Nov 26). What earlier app runs spent today is carried in from a small store
// (a JSON file on the Mac with just the day and the total). At the cap, new messages are refused
// until the next day. maxBudgetUsd on each query is a second, per-session backstop.
export const localDay = (d = new Date()) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD, the Mac's own time zone

export class Budget {
  /**
   * @param {number} capUsd  the daily cap
   * @param {{ store?: { load(): any, save(v: {day: string, spent: number}): void } | null, today?: () => string }} [o]
   */
  constructor(capUsd, { store = null, today = localDay } = {}) {
    this.capUsd = capUsd; this.store = store; this.today = today;
    this.byProject = new Map();
    this.day = today(); this.carried = 0; this.offset = 0;
    let saved = null;
    try { saved = store?.load(); } catch { /* no file yet, or unreadable: start from zero */ }
    if (saved && saved.day === this.day && Number.isFinite(saved.spent) && saved.spent >= 0) this.carried = saved.spent;
  }
  runTotal() { let s = 0; for (const v of this.byProject.values()) s += v; return s; }
  /** A new day: what this run spent before midnight no longer counts. */
  rollover() {
    const d = this.today();
    if (d !== this.day) { this.day = d; this.carried = 0; this.offset = this.runTotal(); }
  }
  record(project, totalCostUsd) {
    if (typeof totalCostUsd !== 'number' || !(totalCostUsd >= 0)) return;
    this.rollover();
    this.byProject.set(project, totalCostUsd);
    try { this.store?.save({ day: this.day, spent: this.spent }); } catch { /* the meter still works for this run */ }
  }
  get spent() { this.rollover(); return Math.round(Math.max(0, this.carried + this.runTotal() - this.offset) * 10000) / 10000; }
  get left() { return Math.max(0, this.capUsd - this.spent); }
  get reached() { return this.spent >= this.capUsd; }
}
