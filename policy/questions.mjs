// questions.mjs - Claude's multiple-choice questions (its AskUserQuestion tool) as a card you tap.
// Bug fixed Nov 26 (Bromo): the old Allow card let the tool run with no answer in it, so Claude
// said "the tappable question didn't come through" and asked in plain text instead. The SDK wants
// the answers inside the tool's own input: `answers`, keyed by each question's exact text.
// Pure: no I/O. The window sends picks as "a:<option numbers>", one group per question.

export const SKIPPED = 'The person skipped this question. Ask it again in plain words only if you still need the answer; otherwise pick a sensible default and say which.';
export const MALFORMED = 'That question needs 1 to 4 questions with 2 to 4 options each, so it was not shown. Ask in plain words instead.';

const text = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

/** What the card shows, or null when the input isn't a question the card can show. */
export function questionCard(input) {
  const qs = Array.isArray(input?.questions) ? input.questions : [];
  if (qs.length < 1 || qs.length > 4) return null;
  const questions = [];
  for (const q of qs) {
    const question = text(q?.question, 500); const opts = Array.isArray(q?.options) ? q.options : [];
    if (!question || opts.length < 2 || opts.length > 4) return null;
    const options = opts.map((o) => ({ label: text(o?.label, 80), note: text(o?.description, 300) || '' }));
    if (options.some((o) => !o.label)) return null;
    questions.push({ question, header: text(q.header, 24) || '', multiSelect: q.multiSelect === true, options });
  }
  if (new Set(qs.map((q) => q.question)).size !== qs.length) return null; // answers are keyed by question
  return { kind: 'question', plain: questions[0].question, questions };
}

const PICKS = /^a:[0-3](,[0-3]){0,3}(;[0-3](,[0-3]){0,3}){0,3}$/;

/** The window's picks -> { [exact question text]: "label, label" }, or null if they don't fit. */
export function parseAnswer(decision, questions) {
  if (typeof decision !== 'string' || !PICKS.test(decision) || !Array.isArray(questions)) return null;
  const groups = decision.slice(2).split(';');
  if (groups.length !== questions.length) return null;
  const answers = {};
  for (const [i, g] of groups.entries()) {
    const q = questions[i]; const picks = g.split(',').map(Number);
    if (new Set(picks).size !== picks.length || picks.some((n) => n >= q.options.length)) return null;
    if (q.multiSelect !== true && picks.length !== 1) return null;
    answers[q.question] = picks.map((n) => q.options[n].label).join(', ');
  }
  return answers;
}

/** Typing in the chat box while a question waits answers it in your own words. */
export function typedAnswers(typed, questions) {
  const words = String(typed).trim().slice(0, 2000);
  return Object.fromEntries(questions.map((q) => [q.question, words]));
}

export const answeredLine = (answers) => `You answered: ${Object.values(answers).join(' · ')}`.slice(0, 300);
