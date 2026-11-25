// budget.mjs - a spending cap across every project in one app run.
// The SDK reports a running total per query (result.total_cost_usd); we keep the latest
// per project and add them up. At the cap, new messages are refused. maxBudgetUsd on each
// query is a second, per-project backstop.
export class Budget {
  constructor(capUsd) { this.capUsd = capUsd; this.byProject = new Map(); }
  record(project, totalCostUsd) {
    if (typeof totalCostUsd === 'number' && totalCostUsd >= 0) this.byProject.set(project, totalCostUsd);
  }
  get spent() { let s = 0; for (const v of this.byProject.values()) s += v; return Math.round(s * 10000) / 10000; }
  get left() { return Math.max(0, this.capUsd - this.spent); }
  get reached() { return this.spent >= this.capUsd; }
}
