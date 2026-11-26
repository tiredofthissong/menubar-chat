// webpass.mjs - "Allow for an hour" on web lookup cards in Dev mode (Bromo, Nov 26: once he allows
// the internet it "should remain allow until the app is quit or 60 minutes, whichever is first").
// Kept narrow on purpose:
//   - only web lookups (WebSearch, WebFetch). Installs, downloads and git push still ask each time.
//   - only in Dev mode, only in the project where you gave it, and only in memory: quitting the
//     app, New chat or a past chat ends it, and nothing is written to disk.
//   - the clock is checked at each lookup, so it ends at the hour even mid-reply.
export const WEB_TOOLS = new Set(['WebSearch', 'WebFetch']);
export const HOUR_MS = 60 * 60 * 1000;

/** @param {{ now?: () => number, ms?: number }} [o] */
export function createWebPass({ now = Date.now, ms = HOUR_MS } = {}) {
  let until = 0;
  return {
    grant() { until = now() + ms; return until; },
    end() { until = 0; },
    active() { return now() < until; },
    get until() { return until; },
  };
}

/** May this call go ahead on the pass? Needs Dev mode, a web lookup and a live pass. */
export function webPassAllows(mode, toolName, pass) {
  return mode === 'dev' && WEB_TOOLS.has(toolName) && pass.active();
}

/** "12:45 PM" in the Mac's own clock, for the line the window shows. */
export const clockTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
