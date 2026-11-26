// hook.mjs - the PreToolUse hook. First line of defense.
// It runs before deny rules, modes and allow rules, so it catches calls that an allow rule
// in ~/.claude/settings.json would otherwise approve without a card. It is registered with
// onFailure 'block', so if this function throws, the tool call is blocked, not allowed.
// For file edits it also keeps a copy of the file first (changes/changes.mjs), so Undo works.
// If that copy can't be made, it throws, and the edit is blocked: no copy, no edit.
import { checkToolCall } from './rules.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

/** @param {{ project, hubPaths?: string[], changes?: { snapshotBefore(id, file): boolean }, onBlocked?: (rule, plain, toolUseID) => void }} ctx */
export function makePreToolUseHook({ project, hubPaths = [], changes = null, onBlocked = () => {} }) {
  return async (input, toolUseID) => {
    if (input?.hook_event_name !== 'PreToolUse') return {};
    const id = toolUseID ?? input.tool_use_id;
    const verdict = checkToolCall({ project, hubPaths }, input.tool_name, input.tool_input || {});
    if (verdict.decision !== 'deny') {
      if (changes && id && EDIT_TOOLS.has(input.tool_name) && input.tool_input?.file_path) changes.snapshotBefore(id, input.tool_input.file_path);
      return {}; // carry on to deny rules, mode and the card
    }
    onBlocked(verdict.rule, verdict.plain, id);
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: verdict.plain,
      },
    };
  };
}
