// permit.mjs - who decides each tool call, for one project session. Kept apart from session.mjs.
//   canUseTool  Claude Code's own "may I?": the hard rules again (second line), then a question
//               card, then Dev mode's folder check and the web pass, then a card for the person.
//   askFirst    called by the PreToolUse hook (policy/hook.mjs) for a step that only looks but
//               reaches outside the project folder. Claude Code runs its own read-only commands
//               (ls, cat, find...) without asking anyone, wherever they point, so the hook asks
//               you itself, in every mode (Bromo's test, Nov 26: `ls ..` ran with no card).
import { explainToolCall } from '../shared/explain.mjs';
import { checkToolCall } from '../policy/rules.mjs';
import { questionCard, MALFORMED } from '../policy/questions.mjs';
import { devModeAllows, looksOutside } from '../policy/devmode.mjs';
import { createWebPass, webPassAllows, WEB_TOOLS, clockTime } from '../policy/webpass.mjs';
import { whyFor } from './translate.mjs';

export const OUTSIDE_LABEL = 'Only looks, outside this project';

/** @param {import('./session.mjs').ProjectSession} s */
export function createPermit(s, { now } = {}) {
  const pass = createWebPass({ now });
  const allow = (input, opts) => ({ behavior: 'allow', updatedInput: input, toolUseID: opts?.toolUseID });

  /** One card for the person: Claude's own "Why:" line first, then the learning link. */
  async function askPerson(toolName, input, opts, card) {
    card.reason = (await whyFor(s.scratch, opts?.toolUseID)) || card.reason;
    const hour = s.mode === 'dev' && WEB_TOOLS.has(toolName); // "Allow for an hour" on web lookups in Dev mode
    return s.broker.ask(toolName, input, opts, { ...card, hour, learn: s.learn.pick(toolName, input, card.danger) });
  }

  async function canUseTool(toolName, input, opts) {
    const verdict = checkToolCall({ project: s.project, hubPaths: s.settings.hubPaths }, toolName, input);
    if (verdict.decision === 'deny') return { behavior: 'deny', message: verdict.plain, toolUseID: opts?.toolUseID };
    if (toolName === 'AskUserQuestion') {
      const asks = questionCard(input); // a question gets a card you tap
      return asks ? s.broker.ask(toolName, input, opts, asks) : { behavior: 'deny', message: MALFORMED, toolUseID: opts?.toolUseID };
    }
    const card = explainToolCall(toolName, input, s.project.path);
    if (s.mode === 'dev' && devModeAllows(toolName, input, s.project.path, card)) return allow(input, opts);
    if (webPassAllows(s.mode, toolName, pass)) return allow(input, opts);
    const answer = await askPerson(toolName, input, opts, card);
    // Leaving Plan first: once you allow the plan, Claude Code goes back to asking before each step.
    if (toolName === 'ExitPlanMode' && answer.behavior === 'allow' && s.mode === 'plan') s.noteMode('default');
    return answer;
  }

  /** From the hook. Returns null when the step stays in the folder (Claude Code decides as usual). */
  async function askFirst(toolName, input, toolUseID, signal) {
    const card = explainToolCall(toolName, input, s.project.path);
    if (!looksOutside(toolName, input, s.project.path, card)) return null;
    const where = /^\.\.\/?$/.test(card.where || '') ? 'the folder that holds this project' : card.where;
    return askPerson(toolName, input, { toolUseID, signal }, { ...card, where, kindLabel: OUTSIDE_LABEL });
  }

  /** Allow for an hour was pressed. The line is what the window shows under the card. */
  function onHour() {
    const until = pass.grant();
    return `Allowed. Web lookups in this project go ahead without asking until ${clockTime(until)}, or until you quit, switch mode or start a new chat.`;
  }

  return { canUseTool, askFirst, onHour, pass };
}
