// Milestone 2 design checks, from the design rules (claude-personal/design): WCAG 2.2 AA contrast
// for every text and control pairing in light and dark, colors inside sRGB, tokens only in app.css.
// The contrast math is a port of the hub's check_tokens.py (OKLCH to sRGB, Ottosson's matrices).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Pairings [text, background, minimum]. 4.5:1 for text, 3:1 for control edges.
const CHECKS = [
  ['fg', 'bg', 4.5], ['fg', 'surface', 4.5], ['fg', 'surface-2', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['muted', 'surface-2', 4.5],
  ['accent', 'bg', 4.5], ['accent', 'surface', 4.5], ['accent-fg', 'accent', 4.5], ['accent-fg', 'accent-hover', 4.5],
  ['fg', 'accent-soft', 4.5], ['border-strong', 'bg', 3], ['border-strong', 'surface', 3],
  ['success', 'surface', 4.5], ['warning', 'surface', 4.5], ['warning', 'bg', 4.5],
  ['danger', 'surface', 4.5], ['danger', 'bg', 4.5], ['focus', 'bg', 3], ['focus', 'surface', 3],
];

function block(css, selector) {
  const i = css.indexOf(selector); assert.ok(i >= 0, selector);
  const open = css.indexOf('{', i + selector.length - 1); let depth = 0;
  for (let j = open; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}' && --depth === 0) return css.slice(open + 1, j); }
  throw new Error(`unclosed ${selector}`);
}
const vars = (text) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

function themes() {
  const css = strip(read('app/window/tokens.css'));
  const light = vars(block(css, ':root {'));
  const darkMedia = vars(block(block(css, '@media (prefers-color-scheme: dark)'), ':root:not([data-theme="light"])'));
  const darkAttr = vars(block(css, ':root[data-theme="dark"]'));
  return { light, dark: { ...light, ...darkMedia }, darkAttr: { ...light, ...darkAttr }, darkMedia };
}

function color(theme, name) {
  let v = theme[`color-${name}`]; assert.ok(v, `--color-${name}`);
  for (let k = 0; k < 4 && /^var\(--[\w-]+\)$/.test(v); k++) v = theme[v.slice(6, -1)]; // var(--color-accent) -> its value
  v = v.replace(/var\(--accent-h\)/g, theme['accent-h']);
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(v); assert.ok(m, `${name}: ${v}`);
  return m.slice(1).map(Number);
}

// OKLCH -> linear sRGB (Ottosson). Returns [r, g, b], unclamped.
function linear([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180); const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const luminance = (lch) => { const [r, g, b] = linear(lch).map((c) => Math.min(1, Math.max(0, c))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (x, y) => { const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };

test('dark mode is the same whether it comes from the Mac setting or data-theme', () => {
  const t = themes();
  for (const [k, v] of Object.entries(t.darkMedia)) assert.equal(t.darkAttr[k], v, k);
});

for (const name of ['light', 'dark']) {
  test(`${name} theme: every pairing meets WCAG 2.2 AA, and every color is inside sRGB`, () => {
    const theme = themes()[name]; const low = [];
    for (const [fg, bg, min] of CHECKS) {
      const r = contrast(color(theme, fg), color(theme, bg));
      if (r < min) low.push(`${fg} on ${bg}: ${r.toFixed(2)} (needs ${min})`);
    }
    assert.deepEqual(low, []);
    for (const key of Object.keys(theme).filter((k) => k.startsWith('color-'))) {
      const out = linear(color(theme, key.slice(6))).some((c) => c < -0.001 || c > 1.001);
      assert.equal(out, false, `${key} is outside sRGB`);
    }
  });
}

test('app.css: tokens only, one accent, two radii plus pill, safe motion, visible focus', () => {
  const css = strip(read('app/window/app.css'));
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i, 'colors come from tokens only');
  assert.doesNotMatch(css, /transition:\s*all|transition-property:\s*all/);
  for (const [, r] of css.matchAll(/border-radius:\s*([^;]+);/g)) assert.match(r, /^var\(--radius-(sm|md|pill)\)$/, r);
  const motion = css.match(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}/g) || [];
  const outside = motion.reduce((c, m) => c.replace(m, ''), css);
  assert.doesNotMatch(outside, /transition|animation/, 'motion only when Reduce Motion is off');
  for (const m of motion) for (const [, props] of m.matchAll(/transition:\s*([^;]+);/g)) {
    for (const part of props.split(',')) assert.match(part.trim(), /^(transform|opacity|background-color|color|border-color)\b/, part);
  }
  assert.doesNotMatch(css, /outline:\s*(none|0)\b/, 'focus is never hidden');
  assert.match(strip(read('app/window/tokens.css')), /:focus-visible\s*\{\s*outline: 2px solid var\(--color-focus\)/);
  const accentUses = [...css.matchAll(/var\(--color-accent[\w-]*\)/g)].length;
  assert.ok(accentUses <= 6, `accent stays rare (${accentUses} uses)`);
});

test('every button and field has a name you can hear, and nothing grabs focus by itself', () => {
  const html = read('app/window/index.html');
  for (const [tag] of html.matchAll(/<(button|select|textarea)\b[^>]*>/g)) {
    const named = /aria-label=|id="(input)"/.test(tag) || /<button[^>]*>[^<]+<\/button>/.test(html.slice(html.indexOf(tag), html.indexOf(tag) + tag.length + 80));
    assert.ok(named, tag);
  }
  const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const all = ['index.html', 'app.js', 'cards.js', 'log.js', 'dom.js', 'panel.js', 'usage-panel.js', 'github-row.js'].map((f) => noComments(read(`app/window/${f}`))).join('\n');
  assert.doesNotMatch(all, /autofocus|tabindex="-1"|tabIndex\s*=\s*-1/);
  assert.doesNotMatch(all, /\btabindex="[1-9]/, 'no custom tab order');
});
