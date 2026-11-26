// hook.mjs - the PreToolUse hook. First line of defense.
// It runs before deny rules, modes and allow rules, so it catches calls that an allow rule
// in ~/.claude/settings.json would otherwise approve without a card. It is registered with
// onFailure 'block', so if this function throws, the tool call is blocked, not allowed.
// For file edits it also keeps a copy of the file first (changes/changes.mjs), so Undo works.
// If that copy can't be made, it throws, and the edit is blocked: no copy, no edit.
// A step that only looks but reaches outside the project folder gets a card from here
// (askFirst, engine/permit.mjs), because Claude Code runs its own read-only commands without
// asking anyone. Your Allow becomes the hook's allow; anything else is a deny.
import { checkToolCall } from './rules.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

/** @param {{ project, hubPaths?: string[], changes?: { snapshotBefore(id, file): boolean }, onBlocked?: (rule, plain, toolUseID) => void, askFirst?: (tool, input, id, signal) => Promise<object|null>, nudge?: (tool, input, id) => string|null }} ctx */
export function makePreToolUseHook({ project, hubPaths = [], changes = null, onBlocked = () => {}, askFirst = null, nudge = null }) {
  return async (input, toolUseID, opts) => {
    if (input?.hook_event_name !== 'PreToolUse') return {};
    const id = toolUseID ?? input.tool_use_id;
    const verdict = checkToolCall({ project, hubPaths }, input.tool_name, input.tool_input || {});
    if (verdict.decision !== 'deny') {
      const held = nudge ? nudge(input.tool_name, input.tool_input || {}, id) : null; // the hand-off check (engine/handoff.mjs)
      if (held) return decide('deny', held);
      if (changes && id && EDIT_TOOLS.has(input.tool_name) && input.tool_input?.file_path) changes.snapshotBefore(id, input.tool_input.file_path);
      const asked = askFirst ? await askFirst(input.tool_name, input.tool_input || {}, id, opts?.signal) : null;
      if (asked) return decide(asked.behavior === 'allow' ? 'allow' : 'deny', asked.behavior === 'allow' ? 'You allowed it.' : asked.message || 'You said no, so it was not run.');
      return {}; // carry on to deny rules, mode and the card
    }
    onBlocked(verdict.rule, verdict.plain, id);
    return decide('deny', verdict.plain);
  };
}

const decide = (permissionDecision, permissionDecisionReason) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason },
});
