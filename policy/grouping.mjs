// grouping.mjs - steps of one kind that Claude asks for together share one card, with one answer
// (Bromo, Nov 26: three web searches came as three cards; "it should all be one permission").
// One kind means web lookups together, or the same tool doing the same kind of step. So a delete
// never shares a card with a step that isn't a delete, an install never rides along with a web
// search, and a question always gets a card of its own.
import { WEB_TOOLS } from './webpass.mjs';

/** null = never shares a card. */
export function groupKey(toolName, card = {}) {
  if (card.kind === 'question' || toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') return null;
  if (WEB_TOOLS.has(toolName)) return `web|${card.hour === true}`;
  return `${toolName}|${card.effect || ''}|${card.kindLabel || ''}|${card.danger === true}`;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

/** One card for every step in the group, listed in the order Claude asked. list: [{ toolName, card }] */
export function mergeCards(list) {
  const [first] = list;
  if (list.length === 1) return { toolName: first.toolName, ...first.card };
  const cards = list.map((m) => m.card);
  const items = cards.flatMap((c) => (Array.isArray(c.items) && c.items.length ? c.items
    : [{ say: cap(c.what || c.plain), target: c.where && !(c.what || '').includes(c.where) ? c.where : '', danger: c.danger === true }]));
  const allSearch = list.every((m) => m.toolName === 'WebSearch');
  const where = cards.every((c) => c.where === first.card.where) ? first.card.where : '';
  const commands = cards.map((c) => c.command).filter(Boolean);
  return {
    ...first.card, toolName: first.toolName, items, where,
    what: allSearch ? `search the web ${list.length} times` : `take ${items.length} steps`,
    plain: allSearch ? `Search the web ${list.length} times.` : `Take ${items.length} steps.`,
    reason: cards.map((c) => c.reason).find(Boolean) || '',
    command: commands.length ? commands.join('\n') : undefined,
    steps: cards.flatMap((c) => c.steps || []),
    danger: cards.some((c) => c.danger === true),
    learn: cards.map((c) => c.learn).find(Boolean) || null,
    count: list.length,
  };
}
