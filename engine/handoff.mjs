// handoff.mjs - big jobs go to Claude Code in Claude's own desktop app, which runs on your Claude
// subscription instead of this app's API key (Bromo, Nov 26: "i'd rather the app hand off jobs
// automatically", and it must not change how the app looks). Claude here ends such a reply with one
// "Handoff:" line; the app opens Claude Desktop's Code tab with that request and the project folder
// filled in, using Anthropic's documented link (claude://code/new). Nothing runs there until you
// press Send, and Claude Desktop asks you to confirm the folder first.
// It opens by itself only when Claude did nothing but read and search this project's own files first
// (Bromo, Nov 26: Claude looked at garden.js, then built the page here). After the web, a file
// outside the folder or any other step, words from there could have written the request, so the
// chat says so and you ask again.
export const HANDOFF_RULE = 'Big jobs go to Claude Code in Claude\'s desktop app, which runs on the person\'s Claude subscription: '
  + 'building a feature or an app across several files, a large rewrite, research across many sources, or long multi-step work. '
  + 'Making a new page, screen or feature counts. For a big job you may read files in this project folder to understand it, '
  + 'but change nothing, run nothing and use no web tools: do not start the work. Reply with one plain sentence saying it is a big job and you are handing it to Claude Code, '
  + 'then a last line that starts with "Handoff:" followed by the whole request as a clear prompt for Claude Code, on one line: what to do, '
  + 'what you already know about this project, and anything the person asked for. Questions, explanations and small fixes you do here as usual. '
  + 'If the person says to do it here, do it here.';
export const MAX_HANDOFF = 5000;
const LINE = /^\s*(?:[-*]\s+)?(?:\*\*)?Handoff:(?:\*\*)?\s*(.*?)\s*$/i;

/** Takes "Handoff:" lines out of whole lines of reply text; keeps the first request in found.prompt. */
export function pullHandoff(text, found) {
  const keep = [];
  for (const line of String(text).split('\n')) {
    const m = LINE.exec(line);
    if (!m) { keep.push(line); continue; }
    const item = m[1].replace(/^["']|["']$/g, '').trim();
    if (item && !found.prompt) found.prompt = item.slice(0, MAX_HANDOFF);
  }
  return keep.join('\n');
}

/** The link that opens Claude Desktop's Code tab with the request and folder. null if either is off. */
export function handoffUrl(prompt, folder) {
  if (typeof prompt !== 'string' || !prompt.trim() || typeof folder !== 'string' || !folder.startsWith('/') || folder.split('/').includes('..')) return null;
  return `claude://code/new?q=${encodeURIComponent(prompt.trim().slice(0, MAX_HANDOFF))}&folder=${encodeURIComponent(folder)}`;
}

/** The only links the app opens for a hand-off: exactly the shape handoffUrl makes. */
export const isHandoffLink = (u) => typeof u === 'string' && u.length < 20000 && /^claude:\/\/code\/new\?q=[^&#]+&folder=%2F[^&#]*$/.test(u);

export const HANDED = 'Opened Claude Code in Claude\'s desktop app with this request. Confirm the folder, read the request, then press Send there. It runs on your Claude subscription.';
export const NOT_OPENED = 'Claude went past reading this project\'s files before handing this off, so I didn\'t open Claude Code by itself. Say "hand it off" to send it over.';
