// next.mjs - Claude's suggested next steps. Claude ends a reply with up to three lines that start
// with "Next:"; they come out of the reply text and the window shows each as a button. A button only
// sends that line as your message, so anything it leads to still asks you first on a card.
export const NEXT_RULE = 'When a next step would clearly help, end your reply with one to three lines that each start with "Next:" '
  + 'followed by a short request the person could send you, in plain words (for example "Next: Run the tests"). '
  + 'Never suggest deleting files or spending money.';
export const MAX_NEXT = 3;
export const MAX_NEXT_LEN = 80;
const LINE = /^\s*(?:[-*]\s+)?(?:\*\*)?Next:(?:\*\*)?\s*(.*?)\s*$/i;

/**
 * Takes the "Next:" lines out of a piece of reply text and adds them to `found`.
 * @param {string} text  whole lines of Claude's reply
 * @param {string[]} found  this reply's suggestions so far (changed in place)
 * @returns {string} the text without those lines
 */
export function pullNext(text, found) {
  const keep = [];
  for (const line of String(text).split('\n')) {
    const m = LINE.exec(line);
    if (!m) { keep.push(line); continue; }
    const item = m[1].replace(/\*\*/g, '').replace(/^["']|["']$/g, '').trim();
    if (!item || item.length > MAX_NEXT_LEN || found.length >= MAX_NEXT) continue;
    if (!found.some((f) => f.toLowerCase() === item.toLowerCase())) found.push(item);
  }
  return keep.join('\n');
}
