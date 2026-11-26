// learn.mjs - the learning layer: one plain line for each kind of card, and "learn more" links
// from a checked list only. Each kind of card has a short list of picks, most useful first: an
// Academy lesson, and a docs passage the link jumps to and highlights. A chat never gets the same
// pick twice; once a kind's picks are used up, its card keeps the line and drops the links.
// Checked Nov 26, 2026: lessons from the Academy's own catalog; every docs passage and section
// below found on the live page by `npm run check-learn` (it fetches each page). Pure: no I/O.

export const LEARN_HOSTS = ['academy.claude.com', 'code.claude.com'];

/** The Academy courses a learning-log entry can be tagged with. */
const A = 'https://academy.claude.com/courses/';
export const COURSES = {
  'Claude Code 101': `${A}claude-code-101`,
  'Claude Code in action': `${A}claude-code-in-action`,
  'Introduction to agent skills': `${A}introduction-to-agent-skills`,
  'Introduction to subagents': `${A}introduction-to-subagents`,
  'Introduction to Model Context Protocol': `${A}introduction-to-model-context-protocol`,
};
const SLUG = Object.fromEntries(Object.entries(COURSES).map(([name, url]) => [url.slice(A.length), name]));

/** topic -> the one plain line, then its picks: [academy lesson path, docs page, section, passage]. */
export const TOPICS = {
  reading: { line: 'Claude reads files to understand your project before it changes anything.', picks: [
    ['claude-code-101/how-claude-code-works', 'how-claude-code-works', 'the-agentic-loop', 'When you give Claude a task, it works through three phases'],
    ['claude-code-101/context-management', 'how-claude-code-works', 'the-context-window', 'As you work, context fills up'],
  ] },
  commands: { line: 'Claude runs Terminal commands for you. Each one waits for your Allow.', picks: [
    ['claude-code-101/how-claude-code-works', 'how-claude-code-works', 'tools', 'Tools are what make Claude Code agentic'],
    ['claude-code-in-action/permission-modes', 'permissions', 'permission-system', 'Claude Code uses a tiered permission system to balance power and safety'],
  ] },
  chain: { line: 'This runs several commands in a row. Every step is listed, and one Allow covers them all.', picks: [
    ['claude-code-in-action/permission-modes', 'permissions', 'compound-commands', 'Every subcommand must be allowed for a compound command to run without a prompt'],
    ['claude-code-101/how-claude-code-works', 'permissions', 'permission-system', 'Claude Code uses a tiered permission system to balance power and safety'],
  ] },
  edits: { line: 'Claude changes files one edit at a time, and Undo puts the old text back.', picks: [
    ['claude-code-in-action/steering-long-sessions', 'how-claude-code-works', 'undo-changes-with-checkpoints', 'File edits are reversible'],
    ['claude-code-101/the-explore-plan-code-commit-workflow', 'checkpointing', 'automatic-tracking', 'Claude Code tracks all changes made by its file editing tools'],
  ] },
  deleting: { line: 'A delete is hard to take back, so Move to Trash is the safer choice.', picks: [
    ['claude-code-101/how-claude-code-works', 'checkpointing', 'bash-command-changes-not-tracked', 'A file that only Bash commands changed'],
    ['claude-code-in-action/permission-modes', 'how-claude-code-works', 'undo-changes-with-checkpoints', 'Actions that affect remote systems'],
  ] },
  git: { line: 'git keeps a history of your project. A push copies that history to GitHub.', picks: [
    ['claude-code-101/the-explore-plan-code-commit-workflow', 'checkpointing', 'not-a-replacement-for-version-control', 'Checkpoints are designed for quick, session-level recovery'],
    ['claude-code-in-action/github-actions-and-code-review', 'common-workflows', 'create-pull-requests', 'You can create pull requests by asking Claude directly'],
  ] },
  planning: { line: 'Plan first lets Claude read and think before it changes anything.', picks: [
    ['claude-code-101/the-explore-plan-code-commit-workflow', 'common-workflows', 'plan-before-editing', 'Claude reads files and proposes a plan but makes no edits until you approve'],
    ['claude-code-in-action/steering-long-sessions', 'how-claude-code-works', 'control-what-claude-can-do', 'Choose a permission mode to set what Claude can do without asking you'],
  ] },
  web: { line: 'Claude can look things up on the web. It asks before it opens a page.', picks: [
    ['claude-code-101/how-claude-code-works', 'how-claude-code-works', 'what-claude-can-access', 'Claude Code gains access to'],
    ['claude-code-in-action/permission-modes', 'permissions', 'permission-system', 'Claude Code uses a tiered permission system to balance power and safety'],
  ] },
  skills: { line: 'A skill is a saved set of steps Claude loads when it fits the job.', picks: [
    ['introduction-to-agent-skills/what-are-skills', 'skills', '', 'Skills extend what Claude can do'],
    ['introduction-to-agent-skills/creating-your-first-skill', 'skills', '', 'Create a skill when you keep pasting the same instructions'],
  ] },
  subagents: { line: 'A subagent is a helper Claude starts for one part of the job.', picks: [
    ['introduction-to-subagents/what-are-subagents', 'sub-agents', '', 'Subagents are specialized AI assistants that handle specific types of tasks'],
    ['introduction-to-subagents/using-subagents-effectively', 'common-workflows', 'delegate-research-to-subagents', 'Delegate the exploration so only the findings come back'],
  ] },
  connectors: { line: 'A connector lets Claude use another app, like GitHub or your hub.', picks: [
    ['claude-code-101/mcp', 'mcp', '', 'MCP servers give Claude Code access to your tools, databases, and APIs'],
    ['introduction-to-model-context-protocol/introducing-mcp', 'mcp', '', 'Connect a server when you find yourself copying data into chat from another tool'],
  ] },
};

/** A link that opens the docs page at the section and highlights the passage (a text fragment). */
const frag = (s) => encodeURIComponent(s).replace(/-/g, '%2D');
export const docsLink = (page, section, passage) => `https://code.claude.com/docs/en/${page}#${section}:~:text=${frag(passage)}`;
const pickOf = ([lesson, page, section, passage]) => ({
  id: `${lesson}|${page}#${section}|${passage}`, course: SLUG[lesson.split('/')[0]],
  academy: `${A}${lesson}`, docs: docsLink(page, section, passage), page, section, passage,
});
export const PICKS = Object.fromEntries(Object.entries(TOPICS).map(([t, v]) => [t, v.picks.map(pickOf)]));

const CHAIN = /&&|\|\||;|\|/;
/** Which topic a tool call is about. */
export function topicFor(toolName, input = {}, danger = false) {
  if (danger) return 'deleting';
  if (/^mcp__/.test(toolName)) return 'connectors';
  if (toolName === 'Bash') {
    const cmd = String(input.command ?? '');
    return /(^|[\s;&|(])git\s/.test(cmd) ? 'git' : CHAIN.test(cmd) ? 'chain' : 'commands';
  }
  const by = { Edit: 'edits', MultiEdit: 'edits', Write: 'edits', NotebookEdit: 'edits', ExitPlanMode: 'planning', Read: 'reading',
    Grep: 'reading', Glob: 'reading', WebFetch: 'web', WebSearch: 'web', Skill: 'skills', Task: 'subagents', Agent: 'subagents' };
  return by[toolName] || 'commands';
}

/**
 * One picker per chat: each card gets the most useful pick it hasn't had yet.
 * @returns {{ pick(toolName, input, danger): { topic, line, course, academy?, docs?, seen? } }}
 */
export const MORE_LINE = 'More on this kind of step:';
export function createLearnPicker() {
  const used = new Set(); const told = new Set();
  return {
    pick(toolName, input, danger) {
      const topic = topicFor(toolName, input, danger);
      // A lesson or passage shown earlier in this chat, on any kind of card, isn't offered again.
      // The plain line shows once per kind of step in a chat (Bromo, Nov 26: cards shouldn't get
      // annoying over time); after that a card only offers what's new, or nothing at all.
      const again = told.has(topic); told.add(topic);
      const line = again ? MORE_LINE : TOPICS[topic].line;
      const p = PICKS[topic].find((x) => !used.has(x.academy) || !used.has(x.docs));
      if (!p) return { topic, ...(again ? {} : { line }), course: PICKS[topic][0].course, seen: true };
      const out = { topic, line, course: p.course };
      if (!used.has(p.academy)) out.academy = p.academy;
      if (!used.has(p.docs)) out.docs = p.docs;
      used.add(p.academy); used.add(p.docs);
      return out;
    },
  };
}
/** A one-off pick, with no memory of the chat. */
export const learnFor = (toolName, input, danger) => createLearnPicker().pick(toolName, input, danger);

/** Only links from this file, exactly. Anything else, however close, is refused. */
const ALLOWED = new Set([...Object.values(COURSES), ...Object.values(PICKS).flat().flatMap((p) => [p.academy, p.docs])]);
export function isLearnLink(url) {
  if (typeof url !== 'string' || !ALLOWED.has(url)) return false;
  try { const u = new URL(url); return u.protocol === 'https:' && LEARN_HOSTS.includes(u.hostname) && !u.username && !u.port && !u.search; } catch { return false; }
}
export const ALL_LINKS = [...ALLOWED];
