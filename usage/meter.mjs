// meter.mjs - this chat's usage: how full the context is and what this chat has cost.
// The chat's cost comes from the budget's record (usage/budget.mjs), which counts only what each
// result adds, so a chat that carries on in a fresh Claude Code process neither drops nor doubles
// what it had cost. modelUsage[model].contextWindow is the window size; each assistant message's
// usage gives the tokens sent. Plan limits (5-hour, weekly) don't apply to an API key, so the
// daily cap stands in for them. Every dollar figure is Claude Code's estimate, not the bill.
// Idea from Caprock (Apache-2.0), rewritten; adapted from this project's code-health prototype.
export function createMeter() {
  let chatUsd = 0; let contextTokens = 0; let contextWindow = null; let priceUnknown = false;
  return {
    /** tokens = input + cache tokens of the latest request */
    onRequestTokens(tokens) { if (Number.isFinite(tokens) && tokens >= 0) contextTokens = tokens; },
    onResult({ chatUsd: usd, windows = [], priceUnknown: unknown = false }) {
      if (typeof usd === 'number' && usd >= 0) chatUsd = usd;
      const w = windows.filter((n) => typeof n === 'number' && n > 0);
      if (w.length) contextWindow = Math.max(...w);
      priceUnknown = Boolean(unknown);
    },
    /** A new or past chat: start from what the record says it cost (0 for a new one). */
    reset(cost = 0) { chatUsd = cost || 0; contextTokens = 0; contextWindow = null; priceUnknown = false; },
    snapshot() {
      return {
        contextPct: contextWindow ? Math.min(100, Math.round((contextTokens / contextWindow) * 1000) / 10) : null,
        chatUsd: Math.round(chatUsd * 10000) / 10000,
        priceUnknown, // show "?" rather than a made-up $0
      };
    },
  };
}
