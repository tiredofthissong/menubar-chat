// hook.mjs - the PreToolUse hook. First line of defense.
// It runs before deny rules, modes and allow rules, so it catches calls that an allow rule
// in ~/.claude/settings.json would otherwise approve without a card. It is registered with
// onFailure 'block', so if this function throws, the tool call is blocked, not allowed.
import { checkToolCall } from './rules.mjs';

/** @param {{ project, hubPaths?: string[], onBlocked?: (rule, plain, toolUseID) => void }} ctx */
export function makePreToolUseHook({ project, hubPaths = [], onBlocked = () => {} }) {
  return async (input, toolUseID) => {
    if (input?.hook_event_name !== 'PreToolUse') return {};
    const verdict = checkToolCall({ project, hubPaths }, input.tool_name, input.tool_input || {});
    if (verdict.decision !== 'deny') return {}; // carry on to deny rules, mode and the card
    onBlocked(verdict.rule, verdict.plain, toolUseID ?? input.tool_use_id);
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: verdict.plain,
      },
    };
  };
}
