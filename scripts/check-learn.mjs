// check-learn.mjs - DEVELOPER CHECK ONLY (needs the internet): opens every docs page the learn-more
// links point at, and checks that the section exists and the highlighted passage is on the page,
// word for word, as a reader sees it. Run it when the list in shared/learn.mjs changes:
//   npm run check-learn
// Academy lessons are checked against the Academy's own catalog, not here (its pages need a browser).
import { PICKS, isLearnLink } from '../shared/learn.mjs';

/** What a reader sees: the page text without scripts, styles, tags or extra spaces. */
export function visibleText(html) {
  return html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;|&rsquo;|’/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

async function main() {
  const pages = new Map(); let bad = 0; let n = 0;
  for (const p of Object.values(PICKS).flat()) {
    if (!pages.has(p.page)) {
      const res = await fetch(`https://code.claude.com/docs/en/${p.page}`);
      pages.set(p.page, res.ok ? await res.text() : '');
    }
    const html = pages.get(p.page); n++;
    const problems = [];
    if (!html) problems.push('page did not load');
    if (p.section && !html.includes(`id="${p.section}"`)) problems.push(`no section #${p.section}`);
    if (!visibleText(html).includes(p.passage)) problems.push('passage not on the page');
    if (!isLearnLink(p.docs) || !isLearnLink(p.academy)) problems.push('not on the checked list');
    if (problems.length) { bad++; console.log(`NOT OK ${p.page}#${p.section} "${p.passage}": ${problems.join(', ')}`); }
  }
  console.log(`${n - bad} of ${n} learn-more passages found on the live pages.`);
  process.exitCode = bad ? 1 : 0;
}
if (import.meta.url === `file://${process.argv[1]}`) main();
