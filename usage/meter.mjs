// meter.mjs - this chat's usage: how full the context is and what this chat has cost.
// Sources (sdk.d.ts, SDK 0.3.332): result.total_cost_usd is a RUNNING total for the query
// (take the latest, never add them up); modelUsage[model].contextWindow is the window size;
// each assistant message's usage gives the tokens sent. Plan limits (5-hour, weekly) don't
// apply to an API key, so the daily cap (usage/budget.mjs) stands in for them.
// Idea from Caprock (Apache-2.0), rewritten; adapted from this project's code-health prototype.
export function createMeter() {
  let chatUsd = 0; let contextTokens = 0; let contextWindow = null; let priceUnknown = false;
  return {
    /** tokens = input + cache tokens of the latest request */
    onRequestTokens(tokens) { if (Number.isFinite(tokens) && tokens >= 0) contextTokens = tokens; },
    onResult({ totalCostUsd, windows = [], priceUnknown: unknown = false }) {
      if (typeof totalCostUsd === 'number' && totalCostUsd >= 0) chatUsd = totalCostUsd;
      const w = windows.filter((n) => typeof n === 'number' && n > 0);
      if (w.length) contextWindow = Math.max(...w);
      priceUnknown = Boolean(unknown);
    },
    reset() { chatUsd = 0; contextTokens = 0; contextWindow = null; priceUnknown = false; },
    snapshot() {
      return {
        contextPct: contextWindow ? Math.min(100, Math.round((contextTokens / contextWindow) * 1000) / 10) : null,
        chatUsd: Math.round(chatUsd * 10000) / 10000,
        priceUnknown, // show "?" rather than a made-up $0
      };
    },
  };
}
