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
// Bromo, Nov 26: on a fertiliser page Claude read the spec, asked questions, planned, then built it
// here when he said "build". Planning here is fine and cheap; the building is what moves.
export const HANDOFF_RULE = 'Big jobs are built in Claude Code in Claude\'s desktop app, which runs on the person\'s Claude subscription: '
  + 'building a feature, page, screen or app, changes across several files, a large rewrite, research across many sources, or long multi-step work. '
  + 'For a big job you may read files in this project folder, ask the person questions and agree a plan here, but do not change files, run commands or use web tools for it. '
  + 'When the work itself would start (the plan is agreed, or the person says build, go, start or do it), hand it off instead of doing it, '
  + 'even when this project\'s own rules describe a build step: the building happens in Claude Code. '
  + 'To hand off, reply with one plain sentence saying you are handing the build to Claude Code, '
  + 'then a last line that starts with "Handoff:" followed by the whole request as a clear prompt for Claude Code, on one line: what to build, '
  + 'the agreed plan and the person\'s answers, what you know about this project, and that the person already said to build. '
  + 'Questions, explanations and small fixes you do here as usual. If the person says to do it here, do it here.';
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

// A check at the first file change of a turn (Bromo, Nov 26: twice Claude built a whole page here
// anyway). The step is held back once with this note, so Claude decides then: hand off, or carry on.
// One Edit to one file is a small fix and goes straight through; so does anything after "do it here".
export const NUDGE = 'Not run yet: this app checks the hand-off rule before the first file change in a reply. '
  + 'If this is a big job (a new feature, page or screen, or changes across several files), change nothing more: '
  + 'reply with one sentence and the "Handoff:" line, with the whole plan, the person\'s answers and anything already done. '
  + 'If it is a small fix, or the person said to do it here, run this same step again and carry on.';
const FILE_STEP = /^(Write a file|Add to a file|Copy files|Add a file onto another|Make a file from another|Change a file|Make a folder|Create an empty file|Move or rename files)$/;
const HERE = /\b(do|build|make|keep) (it|this|that) here\b|\bin this app\b/i;

export function createHandoffNudge(explain) {
  const st = { asked: false, here: false, edited: new Set(), held: new Set() };
  const changes = (name, input) => {
    if (name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit') return true;
    if (name === 'Edit') { st.edited.add(input?.file_path); return st.edited.size > 1; } // a second file
    return name === 'Bash' && explain('Bash', input).items.some((i) => FILE_STEP.test(i.say));
  };
  return {
    /** A new message from the person. */
    newTurn(text) { st.asked = false; st.here = HERE.test(String(text ?? '')); st.edited.clear(); st.held.clear(); },
    /** The note for Claude if this step is held back, else null. */
    check(name, input, id) {
      if (st.asked || st.here || !changes(name, input)) return null;
      st.asked = true; if (id) st.held.add(id);
      return NUDGE;
    },
    wasHeld: (id) => st.held.has(id),
  };
}
