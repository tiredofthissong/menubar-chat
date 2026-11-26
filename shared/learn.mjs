// learn.mjs - the learning layer: one plain line for each kind of card, and "learn more" links
// from a checked list only. Every link points at Claude Academy or the Claude Code docs, and was
// opened and checked on Nov 26, 2026 (academy course list from the Academy's own catalog).
// Pure: no I/O. The app opens a link only if isLearnLink() says it's one of these.

export const LEARN_HOSTS = ['academy.claude.com', 'code.claude.com'];

/** The Academy courses a learning-log entry can be tagged with. */
export const COURSES = {
  'Claude Code 101': 'https://academy.claude.com/courses/claude-code-101',
  'Claude Code in action': 'https://academy.claude.com/courses/claude-code-in-action',
  'Introduction to agent skills': 'https://academy.claude.com/courses/introduction-to-agent-skills',
  'Introduction to subagents': 'https://academy.claude.com/courses/introduction-to-subagents',
  'Introduction to Model Context Protocol': 'https://academy.claude.com/courses/introduction-to-model-context-protocol',
};

const DOCS = 'https://code.claude.com/docs/en/';
/** topic -> the one plain line, its Academy course and one docs page. */
export const TOPICS = {
  reading: { line: 'Claude reads files to understand your project before it changes anything.', course: 'Claude Code 101', docs: `${DOCS}overview` },
  commands: { line: 'Claude runs Terminal commands for you. Each one waits for your Allow.', course: 'Claude Code 101', docs: `${DOCS}permissions` },
  edits: { line: 'Claude changes files one edit at a time, and Undo puts the old text back.', course: 'Claude Code 101', docs: `${DOCS}checkpointing` },
  deleting: { line: 'A delete is hard to take back, so Move to Trash is the safer choice.', course: 'Claude Code 101', docs: `${DOCS}permissions` },
  git: { line: 'git keeps a history of your project. A push copies that history to GitHub.', course: 'Claude Code in action', docs: `${DOCS}common-workflows` },
  planning: { line: 'Plan first lets Claude read and think before it changes anything.', course: 'Claude Code in action', docs: `${DOCS}common-workflows` },
  web: { line: 'Claude can look things up on the web. It asks before it opens a page.', course: 'Claude Code 101', docs: `${DOCS}permissions` },
  skills: { line: 'A skill is a saved set of steps Claude loads when it fits the job.', course: 'Introduction to agent skills', docs: `${DOCS}skills` },
  subagents: { line: 'A subagent is a helper Claude starts for one part of the job.', course: 'Introduction to subagents', docs: `${DOCS}sub-agents` },
  connectors: { line: 'A connector lets Claude use another app, like GitHub or your hub.', course: 'Introduction to Model Context Protocol', docs: `${DOCS}mcp` },
};

/** Which topic a tool call is about. */
export function topicFor(toolName, input = {}, danger = false) {
  if (danger) return 'deleting';
  if (/^mcp__/.test(toolName)) return 'connectors';
  if (toolName === 'Bash') return /(^|[\s;&|(])git\s/.test(String(input.command ?? '')) ? 'git' : 'commands';
  const by = { Edit: 'edits', MultiEdit: 'edits', Write: 'edits', NotebookEdit: 'edits', ExitPlanMode: 'planning', Read: 'reading',
    Grep: 'reading', Glob: 'reading', WebFetch: 'web', WebSearch: 'web', Skill: 'skills', Task: 'subagents', Agent: 'subagents' };
  return by[toolName] || 'commands';
}

/** What a card carries: { topic, line, course, academy, docs }. */
export function learnFor(toolName, input, danger) {
  const topic = topicFor(toolName, input, danger); const t = TOPICS[topic];
  return { topic, line: t.line, course: t.course, academy: COURSES[t.course], docs: t.docs };
}

/** Only links from this file, exactly. Anything else, however close, is refused. */
const ALLOWED = new Set([...Object.values(COURSES), ...Object.values(TOPICS).map((t) => t.docs)]);
export function isLearnLink(url) {
  if (typeof url !== 'string' || !ALLOWED.has(url)) return false;
  try { const u = new URL(url); return u.protocol === 'https:' && LEARN_HOSTS.includes(u.hostname) && !u.username && !u.port; } catch { return false; }
}
export const ALL_LINKS = [...ALLOWED];
