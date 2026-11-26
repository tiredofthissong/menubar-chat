// sessions.mjs - the history list for one project folder (shown in the sidebar from milestone 4).
// Source of truth: Claude Code's own session files (~/.claude/projects/...), read through the
// SDK's listSessions({ dir }). The app keeps no second copy of your history.
// Grouped by the real folder each session reports, not by decoding folder names
// (CloudCLI lesson, clean-room: folder names with hyphens decode wrongly).
import { redact } from '../shared/redact.mjs';

/**
 * @param {{ path: string }} project
 * @param {(opts: object) => Promise<Array>} listSessions  the SDK function (passed in for tests)
 */
export async function listProjectSessions(project, listSessions, limit = 20) {
  const all = await listSessions({ dir: project.path, limit: limit * 2 });
  return (Array.isArray(all) ? all : [])
    .filter((s) => s && typeof s.sessionId === 'string' && !s.archived && (!s.cwd || s.cwd === project.path))
    .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0))
    .slice(0, limit)
    .map((s) => ({
      sessionId: s.sessionId,
      title: redact(String(s.customTitle || s.summary || s.firstPrompt || 'Untitled chat')).replace(/\s+/g, ' ').slice(0, 80),
      lastModified: s.lastModified ?? null,
    }));
}
